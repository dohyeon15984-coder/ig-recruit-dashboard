// "새로운 AI 인사이트": 대시보드 데이터를 Claude에게 보내 채용분석관 관점의 분석 리포트를 받아온다.
// 외부 SDK 없이 Anthropic Messages API를 fetch로 직접 호출한다(.env의 ANTHROPIC_API_KEY 필요).
// 요청마다 소액이 과금되므로, 키는 반드시 로컬 PC의 .env에만 두고 공유용 사이트(Render)에는 넣지 않는다.

const DEFAULT_MODEL = 'claude-sonnet-5';
const TYPE_LABEL = { VIDEO: '릴스', CAROUSEL_ALBUM: '카드뉴스' };

const kstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString();
const pct = (v) => (v == null ? null : Math.round(v * 1000) / 10);

function interactions(p) {
  return (p.like_count || 0) + (p.comments_count || 0) + (p.saved || 0) + (p.shares || 0) + (p.reposts || 0);
}

// Claude에게 줄 요약 데이터. 게시물 전체 표 + 집계를 작게 압축해서 토큰을 아낀다.
function buildSummary({ posts, history, adCampaigns, categories }) {
  const sorted = [...posts].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const postRows = sorted.map((p) => {
    const base = p.reach || p.views || 0;
    return {
      date: kstDate(p.timestamp).slice(0, 10),
      dow: '일월화수목금토'[new Date(kstDate(p.timestamp)).getUTCDay()],
      hour: Number(kstDate(p.timestamp).slice(11, 13)),
      type: TYPE_LABEL[p.media_type] || p.media_type,
      cat: p.category || '미분류',
      collab: p.is_collab ? (p.collab_partner || 'Y') : '',
      views: p.views ?? null,
      reach: p.reach ?? null,
      likes: p.like_count || 0,
      comments: p.comments_count || 0,
      saved: p.saved || 0,
      shares: p.shares || 0,
      profileVisits: p.profile_visits ?? null,
      follows: p.follows ?? null,
      engagementPct: base ? pct(interactions(p) / base) : null,
      caption: (p.caption || '').replace(/\s+/g, ' ').slice(0, 40)
    };
  });

  const catAgg = {};
  for (const p of sorted) {
    const c = p.category || '미분류';
    const a = (catAgg[c] ||= { posts: 0, interactions: 0, reach: 0, follows: 0 });
    a.posts++;
    a.interactions += interactions(p);
    a.reach += p.reach || p.views || 0;
    a.follows += p.follows || 0;
  }
  const categoryStats = Object.entries(catAgg).map(([cat, a]) => ({
    cat,
    posts: a.posts,
    engagementPct: a.reach ? pct(a.interactions / a.reach) : null,
    totalReach: a.reach,
    follows: a.follows
  }));

  const followerSeries = history
    .filter((h) => h.follower_count != null)
    .map((h) => [h.date, h.follower_count]);
  const monthly = new Map();
  for (const [d, v] of followerSeries) monthly.set(d.slice(0, 7), v);

  const postsPerMonth = {};
  for (const r of postRows) postsPerMonth[r.date.slice(0, 7)] = (postsPerMonth[r.date.slice(0, 7)] || 0) + 1;

  const ads = adCampaigns.map((c) => {
    const eng = (c.likes || 0) + (c.saved || 0) + (c.shares || 0);
    return {
      period: `${c.startDate}~${c.endDate}`,
      note: c.note || '',
      spendKRW: c.spend,
      views: c.views,
      reach: c.reach,
      profileVisits: c.profileVisits,
      follows: c.followerGrowth,
      cpmKRW: c.reach ? Math.round((c.spend / c.reach) * 1000) : null,
      engagementPct: c.reach ? pct(eng / c.reach) : null,
      profileVisitRatePct: c.reach ? pct(c.profileVisits / c.reach) : null,
      followConversionPct: c.profileVisits ? pct(c.followerGrowth / c.profileVisits) : null,
      costPerFollowerKRW: c.followerGrowth ? Math.round(c.spend / c.followerGrowth) : null
    };
  });

  return {
    account: '@donga_recruit (동아일보 채용 인스타그램)',
    asOf: new Date().toISOString().slice(0, 10),
    followersMonthEnd: Object.fromEntries(monthly),
    postsPerMonth,
    categories,
    categoryStats,
    ads,
    posts: postRows
  };
}

const SYSTEM_PROMPT = `당신은 동아일보 채용팀 소속 "채용분석관"입니다. 채용 인스타그램 계정(@donga_recruit)의 실제 데이터를 보고, 다음에 무엇을 하면 좋을지 주체적으로 판단해 알려줍니다.

원칙:
- 제공된 데이터에 있는 숫자만 근거로 씁니다. 없는 수치를 만들지 마세요. 근거가 되는 숫자는 본문에 그대로 인용하세요.
- 표본이 작으면(게시물 수가 적은 카테고리, 광고 4건 등) 확정하지 말고 "가설"이라고 밝히세요. 참여율은 도달이 작을수록 우연히 높게 나올 수 있습니다.
- 공동 게시물(collab)은 다른 계정 팔로워에게도 노출되어 도달이 커지므로 단독 게시물과 단순 비교하지 마세요.
- 광고 데이터(ads)는 광고로 생긴 수치만이고, 게시물 데이터(posts)는 오가닉+광고 합계입니다. 둘을 섞어 계산하지 마세요.
- 팔로우/프로필 방문은 릴스에서 제공되지 않아 null일 수 있습니다.
- 채용 목적(지원 유도, 직무·조직문화 이해, 브랜드 호감)에 비추어 판단하고, 실행 가능한 제안만 하세요. 막연한 일반론은 쓰지 마세요.

반드시 아래 JSON만 출력하세요(코드블록·설명 없이).
{
 "headline": "현재 계정 상태를 한 문장으로 진단",
 "strengths": [{"title": "...", "detail": "근거 수치를 포함한 2~3문장"}],
 "concerns": [{"title": "...", "detail": "..."}],
 "nextActions": [{"priority": 1, "title": "다음에 할 일", "why": "근거(수치 인용)", "how": "구체적 실행 방법", "confidence": "높음|중간|낮음(가설)"}],
 "dataNotes": ["이 분석의 한계나 확인이 더 필요한 점"]
}
strengths 2~3개, concerns 2~3개, nextActions 3~5개(priority 오름차순), dataNotes 1~3개. 한국어, 간결하고 담백한 문체.`;

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('분석 결과를 해석하지 못했어요(JSON 형식 아님).');
  return JSON.parse(text.slice(start, end + 1));
}

async function generateInsight(payload) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error(
      'ANTHROPIC_API_KEY가 설정되지 않았어요. console.anthropic.com에서 API 키를 발급해 이 PC의 .env 파일에 ANTHROPIC_API_KEY=키 를 추가하고, 대시보드를 다시 켜주세요.'
    );
    err.code = 'NO_KEY';
    throw err;
  }
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const summary = buildSummary(payload);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `다음은 대시보드의 실제 데이터입니다(JSON). 분석해주세요.\n\n${JSON.stringify(summary)}` }]
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Claude API 오류 (${res.status}): ${json.error?.message || '알 수 없는 오류'}`);

  const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const report = extractJson(text);
  return {
    generatedAt: new Date().toISOString(),
    model,
    postCount: summary.posts.length,
    usage: json.usage || null,
    report
  };
}

module.exports = { generateInsight, buildSummary };
