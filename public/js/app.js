const CATEGORY_PLACEHOLDER = '미지정';

const GENDER_LABEL = { F: '여성', M: '남성', U: '미공개' };
const PERSON_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>';
const PERSON_ICON_FULL_SVG =
  '<svg viewBox="0 0 24 24" width="52" height="52" fill="currentColor"><circle cx="12" cy="4.5" r="2.5"/><path d="M12 8.5c-2.8 0-5 1.6-5 4.2V15h2v6.5h6V15h2v-2.3c0-2.6-2.2-4.2-5-4.2z"/></svg>';

// 날짜별 이력을 월 단위로 묶어(같은 달이면 가장 최근 날짜 값 사용) 한 달=한 포인트로 만든다.
// 팔로워 수처럼 스냅샷 성격의(누적 총계) 지표에 사용 — 매일 동기화해도 그래프/KPI가 월별로 유지된다.
function monthlyBucketed(history, field) {
  const byMonth = new Map();
  for (const h of history) {
    if (h[field] == null) continue;
    const month = h.date.slice(0, 7);
    const existing = byMonth.get(month);
    if (!existing || h.date > existing.date) byMonth.set(month, h);
  }
  return [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// 이번 달처럼 아직 다 지나지 않은 달의 합계를, 지난달 "전체"와 비교하면 항상 적어 보여서 불공평하다.
// 그래서 지난달도 이번 달과 같은 날짜(1일~오늘 날짜)까지만 합산해서 공평하게 비교한다.
// pairs: [dateString('YYYY-MM-DD'), value] 배열.
function monthlySumFairCompare(pairs) {
  if (!pairs.length) return { total: null, delta: null, isPartial: false, currentMonth: null };
  const sorted = [...pairs].sort((a, b) => a[0].localeCompare(b[0]));
  const months = [...new Set(sorted.map(([d]) => d.slice(0, 7)))];
  const currentMonth = months[months.length - 1];
  const priorMonth = months[months.length - 2];

  const currentRows = sorted.filter(([d]) => d.slice(0, 7) === currentMonth);
  const total = currentRows.reduce((sum, [, v]) => sum + v, 0);
  if (!priorMonth) return { total, delta: null, isPartial: false, currentMonth };

  const lastDay = Math.max(...currentRows.map(([d]) => Number(d.slice(8, 10))));
  const priorRows = sorted.filter(([d]) => d.slice(0, 7) === priorMonth);
  const priorMonthLastDay = Math.max(...priorRows.map(([d]) => Number(d.slice(8, 10))));
  const priorRowsInRange = priorRows.filter(([d]) => Number(d.slice(8, 10)) <= lastDay);

  // 지난달 같은 기간에 데이터가 아예 없으면(예: 동기화가 그 기간엔 없었음) 0과 비교하는 셈이 되어
  // "+100%"처럼 실제와 다른 증감으로 보일 수 있다 — 이 경우 비교 자체를 하지 않는다.
  const isPartial = lastDay < priorMonthLastDay;
  if (!priorRowsInRange.length) return { total, delta: null, isPartial, lastDay, currentMonth };

  const priorComparable = priorRowsInRange.reduce((sum, [, v]) => sum + v, 0);
  return { total, delta: total - priorComparable, isPartial, lastDay, currentMonth };
}

function renderFollowerHero(data) {
  const el = document.getElementById('followerHero');
  const monthly = monthlyBucketed(data.history, 'follower_count');
  const latestMonth = monthly[monthly.length - 1];
  const prevMonth = monthly[monthly.length - 2];
  const delta = latestMonth && prevMonth ? latestMonth.follower_count - prevMonth.follower_count : null;
  const current = data.account && data.account.followers_count != null ? data.account.followers_count : latestMonth?.follower_count;

  el.innerHTML = `
    <div class="hero-title">현재 팔로워</div>
    <div class="hero-value-row follower-hero-body">
      <div class="follower-hero-icon">${PERSON_ICON_FULL_SVG}</div>
      <div class="follower-hero-value">${current != null ? current.toLocaleString() + '명' : '-'}</div>
      ${
        delta != null
          ? `<div class="hero-delta ${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : ''}${delta.toLocaleString()}명 전월 대비</div>`
          : ''
      }
    </div>
    ${delta == null ? '<div class="hero-empty">한 달 이상 데이터가 쌓이면 전월 대비 증감이 표시돼요.</div>' : ''}
  `;
}

// meaningSuffix 앞에 실제로 집계된 달을 붙인다. 예: 조회수 카드는 "게시물이 발행된 달" 기준이라
// 이번 달에 아직 게시물이 없으면 지난달 데이터가 표시되는데, 그럴 땐 "이번 달"이 아니라
// "8월"처럼 실제 달을 명시해야 헷갈리지 않는다.
function renderMonthlyStatHero(elId, title, meaningSuffix, pairs) {
  const el = document.getElementById(elId);
  const { total, delta, currentMonth } = monthlySumFairCompare(pairs);

  const nowMonth = new Date().toISOString().slice(0, 7);
  const monthLabel = !currentMonth ? '이번 달' : currentMonth === nowMonth ? '이번 달' : `${Number(currentMonth.slice(5, 7))}월`;
  const meaning = `${monthLabel} ${meaningSuffix}`;

  el.innerHTML = `
    <div class="hero-title">${title} <span class="hero-title-note">— ${meaning}</span></div>
    <div class="hero-value-row">
      <div class="follower-hero-value">${total != null ? Math.round(total).toLocaleString() + '회' : '-'}</div>
      ${
        delta != null
          ? `<div class="hero-delta ${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : ''}${Math.round(delta).toLocaleString()}회 전월 대비</div>`
          : ''
      }
    </div>
  `;
}

function renderViewsMonthlyHero(data) {
  const pairs = data.posts.filter((p) => p.views != null).map((p) => [p.timestamp.slice(0, 10), p.views]);
  renderMonthlyStatHero('viewsMonthlyHero', '조회수', '발행된 게시물이 지금까지 모은 노출 총 횟수', pairs);
}

function renderReachMonthlyHero(data) {
  const pairs = data.history.filter((h) => h.reach != null).map((h) => [h.date, h.reach]);
  renderMonthlyStatHero('reachMonthlyHero', '도달수', '게시물을 본 사람 수(중복 제외)', pairs);
}

function renderDemographics(data) {
  const panel = document.getElementById('demographicsPanel');
  const demo = data.demographics;

  if (!demo || !demo.gender) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const genderTotal = Object.values(demo.gender).reduce((a, b) => a + b, 0) || 1;
  const genderEntries = Object.entries(demo.gender)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  document.getElementById('genderBadges').innerHTML = genderEntries
    .map(([key, value]) => {
      const pct = Math.round((value / genderTotal) * 100);
      const cls = key.toLowerCase();
      return `
      <div class="gender-badge">
        <div class="gender-badge-icon ${cls}">${PERSON_ICON_SVG}</div>
        <div>
          <div class="gender-badge-pct">${pct}%</div>
          <div class="gender-badge-label">${GENDER_LABEL[key] || key}</div>
        </div>
      </div>`;
    })
    .join('');

  renderAgeChart(demo.age);
}

const state = {
  filters: { days: 'all', mediaType: 'ALL', category: 'ALL', search: '' },
  sort: { field: 'timestamp', dir: 'desc' },
  adSort: { field: 'startDate', dir: 'desc' },
  postsMonthFilter: 'all',
  postsCategoryFilter: 'all',
  categoryEngagementFilter: null,
  categoryEngagementMetric: 'all',
  data: null
};

function buildQuery(filters) {
  const params = new URLSearchParams();
  if (filters.days && filters.days !== 'all') params.set('days', filters.days);
  if (filters.mediaType && filters.mediaType !== 'ALL') params.set('mediaType', filters.mediaType);
  if (filters.category && filters.category !== 'ALL') params.set('category', filters.category);
  if (filters.search) params.set('search', filters.search);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function fetchDashboard(filters = state.filters) {
  const res = await fetch(`/api/dashboard${buildQuery(filters)}`);
  return res.json();
}

async function refresh() {
  const data = await fetchDashboard();
  state.data = data;
  renderAll(data);
}

function saveRate(post) {
  const base = post.reach || post.views || 0;
  return base ? (post.saved || 0) / base : 0;
}

function thumbHtml(post, cls) {
  if (post.thumbnail_url) {
    return `<img class="${cls}" src="${post.thumbnail_url}" alt="" loading="lazy">`;
  }
  return `<div class="${cls} thumb-placeholder">${MEDIA_TYPE_ICON[post.media_type] || '🖼️'}</div>`;
}

function miniPostRowHtml(p, rank, metricValue) {
  return `
    <div class="mini-post-row" data-post-id="${p.id}">
      <div class="mini-post-rank">${rank}</div>
      ${thumbHtml(p, 'mini-post-thumb')}
      <div class="mini-post-info">
        <div class="mini-post-caption">${escapeHtml(p.caption || '(캡션 없음)').slice(0, 40)}</div>
        <div class="mini-post-meta">${MEDIA_TYPE_LABEL[p.media_type] || p.media_type}${p.category ? ' · ' + p.category : ''}</div>
      </div>
      <div class="mini-post-metric">${metricValue.toLocaleString()}</div>
    </div>`;
}

// 카테고리별 참여율 차트에서 막대를 클릭했을 때, 그 카테고리 게시물만 골라 작은 리스트로 보여준다.
// 같은 막대를 다시 클릭하면 닫히는 토글 방식. metric은 차트 위 드롭다운에서 고른 지표(전체
// 참여율 또는 좋아요/댓글/저장/공유/리포스트 중 하나)로, 차트와 항상 같은 기준을 쓴다.
function categoryEngagementRowHtml(p, metric) {
  const metricConfig = CATEGORY_METRIC_OPTIONS[metric] || CATEGORY_METRIC_OPTIONS.all;
  const rate = metricConfig.rateFn(p);
  return `
    <div class="mini-post-row" data-post-id="${p.id}">
      <div class="mini-post-rank">${new Date(p.timestamp).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</div>
      ${thumbHtml(p, 'mini-post-thumb')}
      <div class="mini-post-info">
        <div class="mini-post-caption">${escapeHtml(p.caption || '(캡션 없음)').slice(0, 40)}</div>
        <div class="mini-post-meta">${MEDIA_TYPE_LABEL[p.media_type] || p.media_type}</div>
      </div>
      <div class="mini-post-metric">${(rate * 100).toFixed(1)}%</div>
    </div>`;
}

function renderCategoryEngagementPostList(posts, category, metric = 'all') {
  const el = document.getElementById('categoryEngagementPostList');
  if (!category) {
    el.innerHTML = '';
    return;
  }
  const metricConfig = CATEGORY_METRIC_OPTIONS[metric] || CATEGORY_METRIC_OPTIONS.all;
  const matches = posts.filter((p) => p.category === category).sort((a, b) => metricConfig.rateFn(b) - metricConfig.rateFn(a));
  el.innerHTML = `
    <div class="category-engagement-post-list-header">
      <span>"${escapeHtml(category)}" 게시물 ${matches.length}개 (${metricConfig.label} 기준 순위)</span>
      <button type="button" class="category-engagement-post-list-close" aria-label="닫기">✕</button>
    </div>
    ${matches.map((p) => categoryEngagementRowHtml(p, metric)).join('') || '<p class="insight-desc">게시물이 없어요.</p>'}
  `;
  el.querySelectorAll('.mini-post-row').forEach((row) => {
    row.addEventListener('click', () => openPostModal(row.dataset.postId));
  });
  el.querySelector('.category-engagement-post-list-close')?.addEventListener('click', () => {
    state.categoryEngagementFilter = null;
    renderCategoryEngagementPostList(posts, null, metric);
  });
}

// 차트와 그 옆 게시물 목록을 현재 state(선택된 카테고리/지표) 기준으로 함께 다시 그린다.
// 최초 렌더와 지표 드롭다운 변경 양쪽에서 재사용한다.
function renderCategoryEngagementSection(posts) {
  renderCategoryChart(
    posts,
    (category) => {
      state.categoryEngagementFilter = state.categoryEngagementFilter === category ? null : category;
      renderCategoryEngagementPostList(posts, state.categoryEngagementFilter, state.categoryEngagementMetric);
    },
    state.categoryEngagementMetric
  );
  renderCategoryEngagementPostList(posts, state.categoryEngagementFilter, state.categoryEngagementMetric);
}

function renderMiniTopList(containerId, posts, field) {
  const container = document.getElementById(containerId);
  if (!posts.length) {
    container.innerHTML = '<p class="insight-desc">데이터가 없어요.</p>';
    return;
  }
  const top3 = [...posts].sort((a, b) => (b[field] || 0) - (a[field] || 0)).slice(0, 3);
  container.innerHTML = top3.map((p, i) => miniPostRowHtml(p, i + 1, p[field] || 0)).join('');
  container.querySelectorAll('.mini-post-row').forEach((el) => {
    el.addEventListener('click', () => openPostModal(el.dataset.postId));
  });
}

function renderTopPosts(posts) {
  renderMiniTopList('topPostsLikes', posts, 'like_count');
  renderMiniTopList('topPostsSaves', posts, 'saved');
  renderMiniTopList('topPostsShares', posts, 'shares');
}

function renderRecentThumbs(posts) {
  const container = document.getElementById('recentThumbs');
  const recent = [...posts].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 5);
  if (!recent.length) {
    container.innerHTML = '<p class="insight-desc">선택한 조건에 해당하는 게시물이 없어요.</p>';
    return;
  }
  container.innerHTML = recent
    .map(
      (p) => `
      <div class="recent-thumb" data-post-id="${p.id}">
        ${thumbHtml(p, '')}
        <div class="recent-thumb-date">${new Date(p.timestamp).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</div>
        ${p.is_collab ? '<div class="recent-thumb-collab">🤝 공동</div>' : ''}
      </div>`
    )
    .join('');

  container.querySelectorAll('.recent-thumb').forEach((el) => {
    el.addEventListener('click', () => openPostModal(el.dataset.postId));
  });
}

function renderLatestPostHero(posts) {
  const el = document.getElementById('latestPostHero');
  if (!posts.length) {
    el.innerHTML = '<div class="hero-title">최근 게시물 성과</div><div class="hero-empty">데이터가 없어요.</div>';
    return;
  }
  const latest = [...posts].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  const er = engagementRate(latest);

  el.innerHTML = `
    <div class="hero-body-row">
      <div class="hero-content">
        <div class="hero-title">최신 게시물 성과 · ${new Date(latest.timestamp).toLocaleDateString('ko-KR')} 게시 <span class="hero-title-note">(가장 최근에 올린 게시물 1건 기준)</span></div>
        <div class="hero-stats-row">
          <div><div class="hero-stat-value">${(latest.views || 0).toLocaleString()}</div><div class="hero-stat-label">조회수</div><div class="hero-stat-meaning">노출된 총 횟수</div></div>
          <div><div class="hero-stat-value">${(latest.reach || 0).toLocaleString()}</div><div class="hero-stat-label">도달</div><div class="hero-stat-meaning">이 게시물을 본 사람 수(중복 제외)</div></div>
        </div>
        <div class="hero-stats-row hero-stats-row-secondary">
          <div><div class="hero-stat-value-sm">${(latest.like_count || 0).toLocaleString()}</div><div class="hero-stat-label">좋아요</div></div>
          <div><div class="hero-stat-value-sm">${(latest.saved || 0).toLocaleString()}</div><div class="hero-stat-label">저장</div></div>
          <div><div class="hero-stat-value-sm">${(latest.shares || 0).toLocaleString()}</div><div class="hero-stat-label">공유</div></div>
          <div><div class="hero-stat-value-sm">${(latest.reposts || 0).toLocaleString()}</div><div class="hero-stat-label">리포스트</div></div>
          <div><div class="hero-stat-value-sm">${(latest.comments_count || 0).toLocaleString()}</div><div class="hero-stat-label">댓글</div></div>
        </div>
        <div class="hero-engagement-row">
          <span class="hero-engagement-value">참여율 ${(er * 100).toFixed(1)}%</span>
          <span class="hero-engagement-note">— 도달 대비 얼마나 반응(좋아요·댓글·저장·공유·리포스트)했는지 보여줘요</span>
        </div>
      </div>
      ${thumbHtml(latest, 'hero-post-thumb')}
    </div>
  `;
  el.querySelector('.hero-post-thumb')?.addEventListener('click', () => openPostModal(latest.id));
}

// 마지막 7일 합계와 그 이전 7일 합계를 비교한다. 전체 기간을 반으로 갈라 비교하면
// 오래된 이상치 하나가 통계를 왜곡할 수 있어(예: -96%처럼), 최근 구간끼리만 비교한다.
function last7VsPrior7(withReach) {
  const vals = withReach.map((h) => h.reach || 0);
  const last7 = vals.slice(-7);
  const prior7 = vals.slice(-14, -7);
  const lastSum = last7.reduce((a, b) => a + b, 0);
  const priorSum = prior7.reduce((a, b) => a + b, 0);
  const pct = prior7.length && priorSum ? ((lastSum - priorSum) / priorSum) * 100 : null;
  return { lastSum, priorSum, pct };
}

function renderReachHero(history) {
  const el = document.getElementById('reachHero');
  const withReach = history.filter((h) => h.reach != null);

  if (withReach.length < 2) {
    el.innerHTML = '<div class="hero-title">도달 추이</div><div class="hero-empty">동기화를 몇 번 더 하면 추이가 쌓여요.</div>';
    return;
  }

  const cmp = last7VsPrior7(withReach);

  el.innerHTML = `
    <div class="hero-title">도달 추이 (최근 7일 합계) <span class="hero-title-note">— 게시물을 본 서로 다른 사람 수(중복 제외)</span></div>
    <div class="hero-stats-row">
      <div><div class="hero-stat-value">${cmp.lastSum.toLocaleString()}</div><div class="hero-stat-label">최근 7일 도달</div></div>
      ${
        cmp.pct != null
          ? `<div class="hero-delta ${cmp.pct >= 0 ? 'pos' : 'neg'}">${cmp.pct >= 0 ? '+' : ''}${cmp.pct.toFixed(0)}% 이전 7일 대비</div>`
          : ''
      }
    </div>
    ${cmp.pct != null ? `<div class="hero-stat-meaning">이전 7일 ${cmp.priorSum.toLocaleString()} → 최근 7일 ${cmp.lastSum.toLocaleString()}</div>` : ''}
    <div class="hero-chart-wrap"><canvas id="reachHeroChart"></canvas></div>
  `;
  renderReachSparkline(withReach.slice(-7));
}

function renderInsights(insights) {
  const list = document.getElementById('insightList');
  list.innerHTML = insights
    .map(
      (i) => `
      <div class="insight-card">
        <div class="insight-icon">${i.icon}</div>
        <div>
          <div class="insight-title">${i.title}</div>
          <div class="insight-desc">${i.description}</div>
        </div>
      </div>`
    )
    .join('');
}

// 전체 게시물 표의 파생 지표. 계산할 수 없으면(릴스는 프로필 방문/팔로우 데이터가 없음) null.
const POST_DERIVED_METRICS = {
  engagement: (p) => (p.reach || p.views ? engagementRate(p) : null),
  profileVisitRate: (p) => (p.profile_visits != null && p.reach ? p.profile_visits / p.reach : null),
  followConversionRate: (p) => (p.follows != null && p.profile_visits ? p.follows / p.profile_visits : null)
};

function postMetricValue(post, field) {
  return field in POST_DERIVED_METRICS ? POST_DERIVED_METRICS[field](post) : post[field];
}

// 핵심 지표별 순위(높을수록 상위) 계산. 값이 없는 게시물은 순위에서 제외, 동점은 같은 순위.
function computePostRanks(posts) {
  const ranks = {};
  for (const field of Object.keys(POST_DERIVED_METRICS)) {
    const valued = posts.map((p) => ({ id: p.id, v: POST_DERIVED_METRICS[field](p) })).filter((x) => x.v != null);
    ranks[field] = { byId: new Map(valued.map(({ id, v }) => [id, valued.filter((o) => o.v > v).length + 1])) };
  }
  return ranks;
}

function sortPosts(posts) {
  const { field, dir } = state.sort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...posts].sort((a, b) => {
    let av = postMetricValue(a, field);
    let bv = postMetricValue(b, field);
    if (av == null || bv == null) {
      // 값이 없는 게시물(프로필 방문 등 데이터 없음)은 정렬 방향과 무관하게 맨 아래로
      if (av == null && bv == null) return 0;
      return av == null ? 1 : -1;
    }
    if (field === 'timestamp') {
      av = new Date(av).getTime();
      bv = new Date(bv).getTime();
    } else if (field === 'media_type') {
      av = MEDIA_TYPE_LABEL[av] || av || '';
      bv = MEDIA_TYPE_LABEL[bv] || bv || '';
      return mult * String(av).localeCompare(String(bv));
    } else {
      av = av || 0;
      bv = bv || 0;
    }
    return av > bv ? mult : av < bv ? -mult : 0;
  });
}

function updateSortArrows() {
  document.querySelectorAll('#postsTable th[data-sort]').forEach((th) => {
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.sort === state.sort.field) {
      arrow.textContent = state.sort.dir === 'asc' ? '▲' : '▼';
    } else {
      arrow.textContent = '';
    }
  });
}

// 광고 집행 1건의 파생 지표를 계산한다. 도달/참여는 게시물 전체 값을 그대로 쓴다 —
// 인스타그램 앱 인사이트 > 광고 탭(전체 탭과 별개로 광고에만 귀속된 수치를 보여주는 화면)에서
// 확인한 값을 사용자가 직접 입력해둔 것을 그대로 쓴다 — 메타 마케팅 API 연동 없이는 "광고로
// 발생한" 도달/참여/팔로워를 게시물의 오가닉+유료 합산 수치에서 따로 떼어낼 방법이 없기
// 때문에, 게시물 데이터를 참조하지 않고 광고 지표를 완전히 독립적인 값으로 다룬다.
const AD_METRIC_FIELDS = ['views', 'reach', 'likes', 'saved', 'shares', 'followerGrowth', 'profileVisits'];

function computeAdMetrics(campaign) {
  const days = Math.max(1, Math.round((new Date(campaign.endDate) - new Date(campaign.startDate)) / (24 * 60 * 60 * 1000)) + 1);
  const metrics = {};
  for (const field of AD_METRIC_FIELDS) metrics[field] = campaign[field] != null ? Number(campaign[field]) : null;

  const { views, reach, likes, saved, shares, followerGrowth, profileVisits } = metrics;
  const hasEngagementInputs = likes != null && saved != null && shares != null;
  const engagement = hasEngagementInputs ? likes + saved + shares : null;
  const rate = engagement != null && reach ? engagement / reach : null;
  const cpm = reach ? (campaign.spend / reach) * 1000 : null;
  const cpe = engagement ? campaign.spend / engagement : null;
  const costPerFollower = followerGrowth != null && followerGrowth > 0 ? campaign.spend / followerGrowth : null;
  // 퍼널 단계 간 전환 비율: 도달 → 프로필 방문 → 팔로우
  const profileVisitRate = profileVisits != null && reach ? profileVisits / reach : null;
  const followConversionRate = followerGrowth != null && profileVisits ? followerGrowth / profileVisits : null;

  return {
    days,
    views,
    reach,
    likes,
    saved,
    shares,
    engagement,
    rate,
    cpm,
    cpe,
    followerGrowth,
    profileVisits,
    costPerFollower,
    profileVisitRate,
    followConversionRate
  };
}

function renderAdsSummary(adCampaigns) {
  const el = document.getElementById('adsSummaryRow');
  if (!adCampaigns.length) {
    el.innerHTML = '<div class="ad-stat-card"><div class="ad-stat-label">광고 집행 내역</div><div class="ad-stat-value">아직 없어요</div></div>';
    return;
  }

  const totalSpend = adCampaigns.reduce((sum, c) => sum + Number(c.spend || 0), 0);
  let totalReach = 0;
  let totalEngagement = 0;
  adCampaigns.forEach((c) => {
    const m = computeAdMetrics(c);
    totalReach += m.reach || 0;
    totalEngagement += m.engagement || 0;
  });
  const avgCpm = totalReach ? (totalSpend / totalReach) * 1000 : null;
  const avgCpe = totalEngagement ? totalSpend / totalEngagement : null;
  const avgSpendPerPost = totalSpend / adCampaigns.length;

  el.innerHTML = `
    <div class="ad-stat-card"><div class="ad-stat-label">총 광고 집행 건수</div><div class="ad-stat-value">${adCampaigns.length}건</div></div>
    <div class="ad-stat-card"><div class="ad-stat-label">누적 광고비</div><div class="ad-stat-value">${Math.round(totalSpend).toLocaleString()}원</div></div>
    <div class="ad-stat-card"><div class="ad-stat-label">게시물당 평균 광고비</div><div class="ad-stat-value">${Math.round(avgSpendPerPost).toLocaleString()}원</div></div>
    <div class="ad-stat-card"><div class="ad-stat-label"><span class="info-hint" data-tooltip="CPM(Cost Per Mille): 도달 1,000회당 광고비">평균 CPM</span></div><div class="ad-stat-value">${avgCpm != null ? Math.round(avgCpm).toLocaleString() + '원' : '-'}</div></div>
  `;
}

// 정렬 기준(field)에 맞는 값을 계산된 지표(m) 또는 원본 캠페인(c)에서 꺼내온다.
function getAdSortValue(c, m, field) {
  if (field === 'startDate') return c.startDate || '';
  if (field === 'spend') return Number(c.spend) || 0;
  if (field in m) {
    const v = m[field];
    return v == null ? -1 : v;
  }
  return 0;
}

function sortAdCampaigns(adCampaigns) {
  const { field, dir } = state.adSort;
  const mult = dir === 'asc' ? 1 : -1;
  const withMetrics = adCampaigns.map((c) => ({ c, m: computeAdMetrics(c) }));
  withMetrics.sort((a, b) => {
    const av = getAdSortValue(a.c, a.m, field);
    const bv = getAdSortValue(b.c, b.m, field);
    if (typeof av === 'string' || typeof bv === 'string') return mult * String(av).localeCompare(String(bv));
    return av > bv ? mult : av < bv ? -mult : 0;
  });
  return withMetrics;
}

function updateAdSortArrows() {
  document.querySelectorAll('#adCampaignsTable th[data-ad-sort]').forEach((th) => {
    const arrow = th.querySelector('.sort-arrow');
    arrow.textContent = th.dataset.adSort === state.adSort.field ? (state.adSort.dir === 'asc' ? '▲' : '▼') : '';
  });
}

// 광고 지표 칸의 라벨/툴팁. 표 렌더링과 클릭 편집 프롬프트 양쪽에서 같이 쓴다.
const AD_METRIC_LABELS = {
  views: '조회수',
  reach: '도달',
  likes: '좋아요 및 공감',
  saved: '저장',
  shares: '공유',
  followerGrowth: '팔로우',
  profileVisits: '프로필 방문'
};

// 퍼널 단계(노출/콘텐츠 반응/프로필 유입/팔로우 전환)의 첫 칸에는 왼쪽 구분선을 넣는다.
const AD_STAGE_START_FIELDS = new Set(['views', 'likes', 'profileVisits', 'followerGrowth']);

const pctText = (v) => (v != null ? (v * 100).toFixed(1) + '%' : '-');
const countText = (v) => (v != null ? Number(v).toLocaleString() : '-');
const wonText = (v) => (v != null ? Math.round(v).toLocaleString() + '원' : '-');

function adMetricCellHtml(campaign, field) {
  const value = campaign[field];
  const text =
    value != null
      ? `${Number(value).toLocaleString()}${field === 'followerGrowth' ? '명' : ''}`
      : '<span class="ad-follower-growth-missing">입력 필요</span>';
  const stageClass = AD_STAGE_START_FIELDS.has(field) ? ' ad-stage-start' : '';
  return `<td class="ad-metric-cell info-hint${stageClass}" data-ad-id="${campaign.id}" data-field="${field}" data-tooltip="인스타그램 앱 인사이트 > 광고 탭에서 확인한 ${AD_METRIC_LABELS[field]} 값이에요. 클릭하면 수정할 수 있어요">${text}</td>`;
}

// 순위를 표시하는 핵심 지표. lower=true면 값이 낮을수록 좋은 지표(CPM)라 낮은 쪽이 1위.
const AD_RANK_FIELDS = [
  { field: 'cpm', lower: true },
  { field: 'rate', lower: false },
  { field: 'profileVisitRate', lower: false },
  { field: 'followConversionRate', lower: false },
  { field: 'costPerFollower', lower: true },
];

// 지표별로 { 캠페인 id -> 순위 } 계산. 값이 없는 캠페인은 순위에서 제외, 동점은 같은 순위.
function computeAdRanks(adCampaigns) {
  const metricsById = adCampaigns.map((c) => ({ id: c.id, m: computeAdMetrics(c) }));
  const ranks = {};
  for (const { field, lower } of AD_RANK_FIELDS) {
    const valued = metricsById.filter(({ m }) => m[field] != null);
    ranks[field] = { total: valued.length, byId: new Map() };
    for (const { id, m } of valued) {
      const better = valued.filter(({ m: o }) => (lower ? o[field] < m[field] : o[field] > m[field])).length;
      ranks[field].byId.set(id, better + 1);
    }
  }
  return ranks;
}

function rankBadge(ranks, id, field) {
  const r = ranks[field];
  const rank = r.byId.get(id);
  if (rank == null) return '';
  return ` <span class="ad-rank${rank === 1 ? ' ad-rank-top' : ''}">${rank}위</span>`;
}

// 2026-08-07 -> 26.08.07
const shortDate = (d) => (d ? d.slice(2).replace(/-/g, '.') : '');

function renderAdCampaignsTable(adCampaigns, posts) {
  const tbody = document.getElementById('adCampaignsTableBody');
  updateAdSortArrows();
  if (!adCampaigns.length) {
    tbody.innerHTML = '<tr><td colspan="19" class="caption-cell">아직 등록된 광고 집행 내역이 없어요. 위에서 등록해보세요.</td></tr>';
    return;
  }

  const postsById = new Map(posts.map((p) => [p.id, p]));
  const sorted = sortAdCampaigns(adCampaigns);
  const ranks = computeAdRanks(adCampaigns);

  tbody.innerHTML = sorted
    .map(({ c, m }, index) => {
      const post = postsById.get(c.postId);
      const captionRaw = post ? post.caption || '(캡션 없음)' : null;
      const postLabel = captionRaw
        ? escapeHtml(captionRaw.slice(0, 24)) + (captionRaw.length > 24 ? '…' : '')
        : '(삭제된 게시물)';
      const displayLabel = c.note ? escapeHtml(c.note) : postLabel;
      return `
      <tr class="ad-row" data-post-id="${post?.id || ''}">
        <td>${index + 1}</td>
        <td class="caption-cell">
          <div style="display:flex; align-items:center; gap:8px;">
            ${thumbHtml(post || {}, 'row-thumb')}
            <div>${displayLabel}</div>
          </div>
        </td>
        <td>${shortDate(c.startDate)} ~ ${shortDate(c.endDate)}</td>
        <td>${m.days}일</td>
        <td>${Math.round(Number(c.spend)).toLocaleString()}원</td>
        ${adMetricCellHtml(c, 'views')}
        ${adMetricCellHtml(c, 'reach')}
        <td class="ad-key">${wonText(m.cpm)}${rankBadge(ranks, c.id, 'cpm')}</td>
        ${adMetricCellHtml(c, 'likes')}
        ${adMetricCellHtml(c, 'saved')}
        ${adMetricCellHtml(c, 'shares')}
        <td class="ad-key">${pctText(m.rate)}${rankBadge(ranks, c.id, 'rate')}</td>
        <td>${wonText(m.cpe)}</td>
        ${adMetricCellHtml(c, 'profileVisits')}
        <td class="ad-key">${pctText(m.profileVisitRate)}${rankBadge(ranks, c.id, 'profileVisitRate')}</td>
        ${adMetricCellHtml(c, 'followerGrowth')}
        <td class="ad-key">${pctText(m.followConversionRate)}${rankBadge(ranks, c.id, 'followConversionRate')}</td>
        <td class="ad-key">${wonText(m.costPerFollower)}${rankBadge(ranks, c.id, 'costPerFollower')}</td>
        <td><button class="ad-delete-btn" data-ad-id="${c.id}">삭제</button></td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('.ad-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await fetch(`/api/ad-campaigns/${btn.dataset.adId}`, { method: 'DELETE' });
      await refresh();
    });
  });

  // 행을 클릭하면 그 게시물 상세로 이동해서 실제 내용을 확인할 수 있다 (광고 수치 자체는
  // 이제 게시물 데이터와 무관해서, 광고 지표는 아래처럼 표에서 직접 고친다).
  tbody.querySelectorAll('.ad-row').forEach((tr) => {
    if (!tr.dataset.postId) return;
    tr.addEventListener('click', () => openPostModal(tr.dataset.postId));
  });

  // 광고 지표는 메타 마케팅 API 연동 없이는 자동으로 가져올 수 없어, 사용자가 인스타그램 앱
  // 인사이트 > 광고 탭에서 확인한 값을 직접 입력해두는 값이다. 언제든 칸을 클릭해서 수정할 수 있다.
  tbody.querySelectorAll('.ad-metric-cell').forEach((td) => {
    td.addEventListener('click', async (e) => {
      e.stopPropagation();
      const campaign = adCampaigns.find((c) => c.id === td.dataset.adId);
      if (!campaign) return;
      const field = td.dataset.field;
      const input = window.prompt(
        `인스타그램 앱 인사이트 > 광고 탭에서 확인한 "${AD_METRIC_LABELS[field]}" 값을 입력하세요.`,
        campaign[field] != null ? campaign[field] : ''
      );
      if (input === null) return;
      const trimmed = input.trim();
      if (trimmed === '') {
        alert('빈 값으로 저장할 수 없어요.');
        return;
      }
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        alert('숫자만 입력해주세요.');
        return;
      }
      await fetch('/api/ad-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...campaign, [field]: n })
      });
      await refresh();
    });
  });
}

const DEFAULT_AD_SORT = { field: 'startDate', dir: 'desc' };

function setupAdSortableHeaders() {
  document.querySelectorAll('#adCampaignsTable th[data-ad-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const field = th.dataset.adSort;
      if (state.adSort.field === field) {
        state.adSort = state.adSort.dir === 'desc' ? { field, dir: 'asc' } : { ...DEFAULT_AD_SORT };
      } else {
        state.adSort = { field, dir: 'desc' };
      }
      if (state.data) renderAdCampaignsTable(state.data.adCampaigns || [], state.data.posts);
    });
  });
}

function populateAdPostSelect(posts) {
  const select = document.getElementById('adPostSelect');
  const sorted = [...posts].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const currentValue = select.value;
  select.innerHTML = sorted
    .map((p) => {
      const dateLabel = new Date(p.timestamp).toLocaleDateString('ko-KR');
      const captionSnippet = escapeHtml((p.caption || '(캡션 없음)').slice(0, 30));
      return `<option value="${p.id}">${dateLabel} · ${captionSnippet}</option>`;
    })
    .join('');
  if (currentValue && sorted.some((p) => p.id === currentValue)) select.value = currentValue;
}

function renderAdsTab(data) {
  populateAdPostSelect(data.posts);
  renderAdsSummary(data.adCampaigns || []);
  renderAdCampaignsTable(data.adCampaigns || [], data.posts);
}

function setupAdCampaignForm() {
  const spendInput = document.getElementById('adSpend');
  // 입력하는 동안 숫자만 남기고 천단위 콤마를 붙여 보여준다 (예: 342639 -> 342,639).
  spendInput.addEventListener('input', () => {
    const digits = spendInput.value.replace(/[^0-9]/g, '');
    spendInput.value = digits ? Number(digits).toLocaleString() : '';
  });

  document.getElementById('adCampaignForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const postId = document.getElementById('adPostSelect').value;
    const startDate = document.getElementById('adStartDate').value;
    const endDate = document.getElementById('adEndDate').value;
    const spend = spendInput.value.replace(/[^0-9]/g, '');
    const note = document.getElementById('adNote').value;
    const metricInputIds = {
      views: 'adViews',
      reach: 'adReach',
      likes: 'adLikes',
      saved: 'adSaved',
      shares: 'adShares',
      followerGrowth: 'adFollowerGrowth',
      profileVisits: 'adProfileVisits'
    };
    const metrics = {};
    for (const [field, inputId] of Object.entries(metricInputIds)) metrics[field] = document.getElementById(inputId).value;

    if (!postId || !startDate || !endDate || !spend || Object.values(metrics).some((v) => v === '')) return;

    await fetch('/api/ad-campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, startDate, endDate, spend, note, ...metrics })
    });
    e.target.reset();
    await refresh();
  });
}

// 게시물 날짜에서 뽑아낸 월(YYYY-MM) 목록으로 필터 드롭다운을 채운다.
function populatePostsMonthFilter(posts) {
  const select = document.getElementById('postsMonthFilter');
  const months = [...new Set(posts.map((p) => p.timestamp.slice(0, 7)))].sort((a, b) => b.localeCompare(a));
  const currentValue = state.postsMonthFilter;

  select.innerHTML =
    '<option value="all">전체</option>' +
    months
      .map((m) => {
        const [y, mo] = m.split('-');
        return `<option value="${m}">${y}년 ${Number(mo)}월</option>`;
      })
      .join('');
  select.value = months.includes(currentValue) || currentValue === 'all' ? currentValue : 'all';
}

// 전체 게시물 표의 "카테고리" 열 헤더 드롭다운을 채운다. 실제 필터링 외에
// 맨 아래 두 항목으로 카테고리 추가/관리(이름변경·삭제)도 여기서 바로 할 수 있게 한다.
function populatePostsCategoryFilter(categories) {
  const select = document.getElementById('postsCategoryFilterSelect');
  const currentValue = state.postsCategoryFilter;

  select.innerHTML =
    '<option value="all">전체</option>' +
    categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('') +
    `<option value="${CATEGORY_PLACEHOLDER}">${CATEGORY_PLACEHOLDER}</option>` +
    '<option disabled>──────────</option>' +
    '<option value="__add__">＋ 새 카테고리 추가</option>' +
    '<option value="__manage__">🛠 카테고리 관리</option>';

  select.value = currentValue === 'all' || categories.includes(currentValue) || currentValue === CATEGORY_PLACEHOLDER
    ? currentValue
    : 'all';
  sizeSelectToSelectedText(select);
}

// 카테고리 도넛 차트 클릭으로 선택한 카테고리에 해당하는 게시물만 걸러낸다.
function filterPostsByCategory(posts, categoryFilter) {
  if (categoryFilter === 'all') return posts;
  if (categoryFilter === CATEGORY_PLACEHOLDER) return posts.filter((p) => !p.category);
  return posts.filter((p) => p.category === categoryFilter);
}

// 도넛 차트를 그리고, 조각을 클릭하면 같은 카테고리를 다시 클릭했을 때 전체로 되돌아가도록
// 토글하면서 도넛(하이라이트)과 전체 게시물 표를 함께 다시 그린다.
function renderCategoryDonutSection(posts) {
  const selected = state.postsCategoryFilter === 'all' ? null : state.postsCategoryFilter;
  renderCategoryDonutChart(posts, selected, (category) => {
    state.postsCategoryFilter = state.postsCategoryFilter === category ? 'all' : category;
    renderCategoryDonutSection(posts);
    if (state.data) renderPostsTable(state.data);
  });
}

// select는 옵션 전체(가장 긴 옵션 텍스트) 기준으로 폭이 고정되는 브라우저 기본 동작 때문에,
// "전체"처럼 짧은 값이 선택돼 있어도 "🛠 카테고리 관리"같은 긴 옵션 때문에 폭이 넓게 남는다.
// 실제 선택된 텍스트 길이만큼만 차지하도록 캔버스로 폭을 재서 매번 직접 지정해준다.
const selectMeasureCanvas = document.createElement('canvas');
function sizeSelectToSelectedText(select, arrowReserve = 22) {
  const cs = getComputedStyle(select);
  const ctx = selectMeasureCanvas.getContext('2d');
  ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
  const text = select.options[select.selectedIndex]?.textContent || '';
  const textWidth = ctx.measureText(text).width;
  const horizontalChrome =
    parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  select.style.width = `${Math.ceil(textWidth + horizontalChrome + arrowReserve)}px`;
}

function renderPostsTable(data) {
  const tbody = document.getElementById('postsTableBody');
  populatePostsMonthFilter(data.posts);
  populatePostsCategoryFilter(data.categories || []);
  const monthFiltered =
    state.postsMonthFilter === 'all' ? data.posts : data.posts.filter((p) => p.timestamp.slice(0, 7) === state.postsMonthFilter);
  const categoryFiltered = filterPostsByCategory(monthFiltered, state.postsCategoryFilter);
  const sorted = sortPosts(categoryFiltered);
  const ranks = computePostRanks(data.posts);
  updateSortArrows();

  const meta = document.getElementById('postsMeta');
  if (data.meta) {
    meta.textContent =
      state.postsMonthFilter === 'all' && state.postsCategoryFilter === 'all' && data.meta.filteredPosts === data.meta.totalPosts
        ? `전체 ${data.meta.totalPosts}개`
        : `전체 ${data.meta.totalPosts}개 중 ${sorted.length}개 표시`;
  }

  tbody.innerHTML = sorted
    .map((p, index) => {
      const options = data.categories
        .map((c) => `<option value="${c}" ${p.category === c ? 'selected' : ''}>${c}</option>`)
        .join('');
      return `
      <tr data-post-id="${p.id}">
        <td>${index + 1}</td>
        <td>${thumbHtml(p, 'row-thumb')}</td>
        <td>${new Date(p.timestamp).toLocaleDateString('ko-KR')}</td>
        <td class="caption-cell">${p.manual ? '<span class="manual-post-badge">직접입력</span> ' : ''}${escapeHtml(p.caption || '').slice(0, 60)}</td>
        <td>
          ${MEDIA_TYPE_LABEL[p.media_type] || p.media_type}
          <label class="row-collab-toggle info-hint" data-tooltip="다른 계정과 함께 올린 공동 게시물이면 체크하세요">
            <input type="checkbox" class="collab-toggle" data-post-id="${p.id}" ${p.is_collab ? 'checked' : ''}>
            공동${p.is_collab && p.collab_partner ? ` (${escapeHtml(p.collab_partner)})` : ''}
          </label>
        </td>
        <td>
          <select class="tag-select" data-post-id="${p.id}">
            <option value="">${CATEGORY_PLACEHOLDER}</option>
            ${options}
          </select>
        </td>
        <td class="ad-stage-start">${(p.views || 0).toLocaleString()}</td>
        <td>${(p.reach || 0).toLocaleString()}</td>
        <td class="ad-stage-start">${(p.like_count || 0).toLocaleString()}</td>
        <td>${(p.comments_count || 0).toLocaleString()}</td>
        <td>${(p.saved || 0).toLocaleString()}</td>
        <td>${(p.shares || 0).toLocaleString()}</td>
        <td>${(p.reposts || 0).toLocaleString()}</td>
        <td class="ad-key">${pctText(POST_DERIVED_METRICS.engagement(p))}${rankBadge(ranks, p.id, 'engagement')}</td>
        <td class="ad-stage-start">${countText(p.profile_visits)}</td>
        <td class="ad-key">${pctText(POST_DERIVED_METRICS.profileVisitRate(p))}${rankBadge(ranks, p.id, 'profileVisitRate')}</td>
        <td class="ad-stage-start">${countText(p.follows)}</td>
        <td class="ad-key">${pctText(POST_DERIVED_METRICS.followConversionRate(p))}${rankBadge(ranks, p.id, 'followConversionRate')}</td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('.collab-toggle').forEach((checkbox) => {
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', async (e) => {
      const postId = e.target.dataset.postId;
      const isCollab = e.target.checked;
      let partner = '';
      if (isCollab) {
        partner = window.prompt('협업한 계정을 입력하세요 (모르면 비워둬도 돼요)') || '';
      }
      await fetch('/api/post-collab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, isCollab, partner })
      });
      await refresh();
    });
  });

  tbody.querySelectorAll('.tag-select').forEach((select) => {
    select.addEventListener('click', (e) => e.stopPropagation());
    select.addEventListener('change', async (e) => {
      const postId = e.target.dataset.postId;
      const category = e.target.value || null;
      await fetch(`/api/posts/${postId}/tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category })
      });
      await refresh();
    });
  });

  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => openPostModal(tr.dataset.postId));
  });
}

function openPostModal(postId) {
  const post = state.data.posts.find((p) => p.id === postId);
  if (!post) return;

  const modal = document.getElementById('postModal');
  const body = document.getElementById('postModalBody');
  const er = engagementRate(post);
  const sr = saveRate(post);

  body.innerHTML = `
  <div class="modal-layout">
    <div class="modal-thumb-col">${thumbHtml(post, 'modal-thumb-full')}</div>
    <div class="modal-content-col">
    <div class="modal-title">${escapeHtml(post.caption || '(캡션 없음)')}</div>
    <div class="modal-meta">
      ${new Date(post.timestamp).toLocaleString('ko-KR')} · ${MEDIA_TYPE_LABEL[post.media_type] || post.media_type}${post.is_collab ? ` · 공동 게시물${post.collab_partner ? ` (${escapeHtml(post.collab_partner)})` : ''}` : ''}${post.category ? ' · ' + post.category : ' · 카테고리 미지정'}${post.manual ? ' · 직접 추가한 게시물' : ''}
    </div>
    <div class="modal-stats">
      <div class="modal-stat">
        <div class="modal-stat-label">참여율</div>
        <div class="modal-stat-value">${(er * 100).toFixed(1)}%</div>
        <div class="modal-stat-formula">(좋아요+댓글+저장+공유+리포스트) ÷ 도달</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-label">저장률</div>
        <div class="modal-stat-value">${(sr * 100).toFixed(1)}%</div>
        <div class="modal-stat-formula">저장 ÷ 도달</div>
      </div>
      <div class="modal-stat"><div class="modal-stat-label">도달</div><div class="modal-stat-value">${(post.reach || 0).toLocaleString()}</div></div>
      <div class="modal-stat"><div class="modal-stat-label">조회수</div><div class="modal-stat-value">${(post.views || 0).toLocaleString()}</div></div>
      <div class="modal-stat"><div class="modal-stat-label">좋아요</div><div class="modal-stat-value">${(post.like_count || 0).toLocaleString()}</div></div>
      <div class="modal-stat"><div class="modal-stat-label">댓글</div><div class="modal-stat-value">${(post.comments_count || 0).toLocaleString()}</div></div>
      <div class="modal-stat"><div class="modal-stat-label">저장</div><div class="modal-stat-value">${(post.saved || 0).toLocaleString()}</div></div>
      <div class="modal-stat"><div class="modal-stat-label">공유</div><div class="modal-stat-value">${(post.shares || 0).toLocaleString()}</div></div>
      <div class="modal-stat"><div class="modal-stat-label">리포스트</div><div class="modal-stat-value">${(post.reposts || 0).toLocaleString()}</div></div>
      <div class="modal-stat"><div class="modal-stat-label">프로필 방문</div><div class="modal-stat-value">${countText(post.profile_visits)}</div></div>
      <div class="modal-stat"><div class="modal-stat-label">팔로우</div><div class="modal-stat-value">${countText(post.follows)}</div></div>
    </div>
    <div class="modal-note">참여율은 도달한 사람 중 얼마나 많은 반응(좋아요·댓글·저장·공유·리포스트)을 이끌어냈는지를 보여줘요. 숫자가 높을수록 도달 대비 콘텐츠 반응이 좋았다는 뜻이에요.</div>
    ${post.permalink && post.permalink !== '#' ? `<a class="modal-link" href="${post.permalink}" target="_blank" rel="noopener">인스타그램에서 보기 →</a>` : ''}
    ${post.manual ? '<button type="button" id="manualPostDelete" class="btn-ghost post-override-actions-standalone">직접 추가한 게시물 삭제</button>' : ''}

    <div class="post-override-section">
      <div class="post-override-title">공동 게시물(콜라보) 정보</div>
      <div class="post-override-desc">메타 API 권한 문제로 공동 게시물 여부가 자동으로 확인되지 않아요. 다른 계정과 함께 올린 게시물이면 직접 체크하고 협업 계정을 적어주세요.</div>
      <label class="post-collab-checkbox">
        <input type="checkbox" id="collabIsCollab" ${post.is_collab ? 'checked' : ''}>
        공동 게시물이에요
      </label>
      <div class="post-override-field">
        <label>협업 계정</label>
        <input type="text" id="collabPartner" placeholder="예: @account_name" value="${escapeHtml(post.collab_partner || '')}">
      </div>
      <div class="post-override-actions">
        <button type="button" id="postCollabSave" class="btn-primary">저장</button>
      </div>
    </div>

    <div class="post-override-section">
      <div class="post-override-title">
        실제 전체 수치 입력 (광고/유료 홍보 포함)
        ${post.has_override ? '<span class="post-override-badge">반영 중</span>' : ''}
      </div>
      <div class="post-override-desc">이 게시물이 광고를 탄 적 있으면, 인스타그램 앱 인사이트에서 보이는 실제 합산 수치를 입력해주세요. 저장하면 위 도달·조회수 등에 반영되고, 요약 카드·차트에도 그대로 쓰여요.</div>
      <div class="post-override-grid">
        <div class="post-override-field"><label>조회수</label><input type="number" min="0" id="ovViews" value="${post.views || 0}"></div>
        <div class="post-override-field"><label>도달</label><input type="number" min="0" id="ovReach" value="${post.reach || 0}"></div>
        <div class="post-override-field"><label>좋아요</label><input type="number" min="0" id="ovLikes" value="${post.like_count || 0}"></div>
        <div class="post-override-field"><label>댓글</label><input type="number" min="0" id="ovComments" value="${post.comments_count || 0}"></div>
        <div class="post-override-field"><label>저장</label><input type="number" min="0" id="ovSaved" value="${post.saved || 0}"></div>
        <div class="post-override-field"><label>공유</label><input type="number" min="0" id="ovShares" value="${post.shares || 0}"></div>
        <div class="post-override-field"><label>리포스트</label><input type="number" min="0" id="ovReposts" value="${post.reposts || 0}"></div>
        <div class="post-override-field"><label>프로필 방문</label><input type="number" min="0" id="ovProfileVisits" value="${post.profile_visits ?? ''}" placeholder="-"></div>
        <div class="post-override-field"><label>팔로우</label><input type="number" min="0" id="ovFollows" value="${post.follows ?? ''}" placeholder="-"></div>
      </div>
      <div class="post-override-actions">
        ${post.has_override ? '<button type="button" id="postOverrideReset" class="btn-ghost">초기화(원래 값으로)</button>' : ''}
        <button type="button" id="postOverrideSave" class="btn-primary">저장</button>
      </div>
    </div>
    </div>
  </div>
  `;
  modal.hidden = false;

  const manualDeleteBtn = document.getElementById('manualPostDelete');
  if (manualDeleteBtn) {
    manualDeleteBtn.addEventListener('click', async () => {
      if (!confirm('직접 추가한 이 게시물을 삭제할까요?')) return;
      await fetch(`/api/manual-posts/${post.id}`, { method: 'DELETE' });
      closePostModal();
      await refresh();
    });
  }

  document.getElementById('postCollabSave').addEventListener('click', async () => {
    const isCollab = document.getElementById('collabIsCollab').checked;
    const partner = document.getElementById('collabPartner').value;
    await fetch('/api/post-collab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: post.id, isCollab, partner })
    });
    await refresh();
    openPostModal(post.id);
  });

  document.getElementById('postOverrideSave').addEventListener('click', async () => {
    await fetch('/api/post-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId: post.id,
        views: document.getElementById('ovViews').value,
        reach: document.getElementById('ovReach').value,
        like_count: document.getElementById('ovLikes').value,
        comments_count: document.getElementById('ovComments').value,
        saved: document.getElementById('ovSaved').value,
        shares: document.getElementById('ovShares').value,
        reposts: document.getElementById('ovReposts').value,
        profile_visits: document.getElementById('ovProfileVisits').value,
        follows: document.getElementById('ovFollows').value
      })
    });
    await refresh();
    openPostModal(post.id);
  });

  const resetBtn = document.getElementById('postOverrideReset');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      await fetch(`/api/post-overrides/${post.id}`, { method: 'DELETE' });
      await refresh();
      openPostModal(post.id);
    });
  }

}

function closePostModal() {
  document.getElementById('postModal').hidden = true;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderModeBadgeAndBanner(data) {
  document.getElementById('syncBtn').hidden = Boolean(data.syncDisabled);

  const banner = document.getElementById('tokenBanner');
  if (data.mode === 'live' && data.tokenStatus) {
    banner.hidden = false;
    banner.textContent =
      data.tokenStatus.daysLeft <= 7
        ? `⚠️ 액세스 토큰이 ${data.tokenStatus.daysLeft}일 후(${data.tokenStatus.expiresAt}) 만료됩니다. scripts/refresh-token.js 로 갱신하세요.`
        : `액세스 토큰 만료일: ${data.tokenStatus.expiresAt} (D-${data.tokenStatus.daysLeft})`;
    banner.className = `token-banner ${data.tokenStatus.daysLeft <= 7 ? 'urgent' : ''}`;
  } else {
    banner.hidden = true;
  }
}

// 게시 활동을 실제 달력으로 보여준다 (게시물 있는 날 색칠, 이전/다음 달 이동 가능).
const calendarState = { monthOffset: 0 };
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function renderPostCalendar(posts) {
  const container = document.getElementById('postCalendar');
  const counts = new Map();
  posts.forEach((p) => {
    const key = p.timestamp.slice(0, 10);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + calendarState.monthOffset);
  const year = base.getFullYear();
  const month = base.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = new Date().toISOString().slice(0, 10);

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const count = counts.get(key) || 0;
    const level = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3;
    const todayCls = key === todayKey ? ' today' : '';
    cells.push(`<div class="cal-cell level-${level}${todayCls}" title="${key} · 게시 ${count}건">${d}</div>`);
  }

  container.innerHTML = `
    <div class="cal-header">
      <button type="button" id="calPrev" class="cal-nav">‹</button>
      <span class="cal-title">${year}년 ${month + 1}월</span>
      <button type="button" id="calNext" class="cal-nav">›</button>
    </div>
    <div class="cal-weekdays">${WEEKDAY_LABELS.map((d) => `<div>${d}</div>`).join('')}</div>
    <div class="cal-grid">${cells.join('')}</div>
  `;

  document.getElementById('calPrev').addEventListener('click', () => {
    calendarState.monthOffset--;
    renderPostCalendar(state.data.posts);
  });
  document.getElementById('calNext').addEventListener('click', () => {
    calendarState.monthOffset++;
    renderPostCalendar(state.data.posts);
  });
}

// 필터 대신 사이드바에 넣는 빠른 요약 지표.
function renderQuickStats(posts) {
  const container = document.getElementById('quickStats');
  if (!posts.length) {
    container.innerHTML = '<div class="quick-stat-row"><span>데이터 없음</span></div>';
    return;
  }

  const sorted = [...posts].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const daysSinceLast = Math.floor((Date.now() - new Date(sorted[0].timestamp).getTime()) / (24 * 60 * 60 * 1000));

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thisMonthCount = posts.filter((p) => new Date(p.timestamp).getTime() >= monthStart.getTime()).length;

  container.innerHTML = `
    <div class="quick-stat-row"><span>마지막 게시</span><strong>${daysSinceLast === 0 ? '오늘' : daysSinceLast + '일 전'}</strong></div>
    <div class="quick-stat-row"><span>이번 달 게시</span><strong>${thisMonthCount}건</strong></div>
  `;
}

// 이 차트(chartKey)에 달린 메모들을 { period: text } 형태로 돌려준다.
function notesByPeriodFor(chartKey) {
  const map = {};
  for (const n of state.data?.chartNotes || []) {
    if (n.chartKey === chartKey) map[n.period] = n.text;
  }
  return map;
}

function makePointClickHandler(chartKey, chartLabel, instanceKey) {
  return (index) => {
    const series = trendChartSeries[instanceKey];
    const point = series && series[index];
    if (point) openNoteModal(chartKey, chartLabel, point);
  };
}

function renderAll(data) {
  renderModeBadgeAndBanner(data);
  renderFollowerHero(data);
  renderViewsMonthlyHero(data);
  renderReachMonthlyHero(data);
  renderPostCalendar(data.posts);
  renderQuickStats(data.posts);
  renderLatestPostHero(data.posts);
  renderReachHero(data.history);
  renderDemographics(data);
  renderInsights(data.insights);
  renderTopPosts(data.posts);
  renderRecentThumbs(data.posts);
  renderPostsTable(data);
  renderAdsTab(data);
  renderFollowerChart(monthlyBucketed(data.history, 'follower_count'));
  renderViewsOnlyChart(data.posts, 'monthly', notesByPeriodFor('views'), makePointClickHandler('views', '조회수', 'views'));
  renderReachOnlyChart(
    data.history,
    document.getElementById('reachGranularity')?.value || 'monthly',
    notesByPeriodFor('reach'),
    makePointClickHandler('reach', '도달', 'reach')
  );
  renderCategoryEngagementSection(data.posts);
  renderCategoryDonutSection(data.posts);
}

const DEFAULT_POST_SORT = { field: 'timestamp', dir: 'desc' };

function setupSortableHeaders() {
  document.querySelectorAll('#postsTable th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (state.sort.field === field) {
        state.sort = state.sort.dir === 'desc' ? { field, dir: 'asc' } : { ...DEFAULT_POST_SORT };
      } else {
        state.sort = { field, dir: 'desc' };
      }
      renderPostsTable(state.data);
    });
  });

  const monthFilter = document.getElementById('postsMonthFilter');
  monthFilter.addEventListener('click', (e) => e.stopPropagation());
  monthFilter.addEventListener('change', (e) => {
    state.postsMonthFilter = e.target.value;
    if (state.data) renderPostsTable(state.data);
  });

  const categoryFilter = document.getElementById('postsCategoryFilterSelect');
  categoryFilter.addEventListener('click', (e) => e.stopPropagation());
  categoryFilter.addEventListener('change', async (e) => {
    const value = e.target.value;

    if (value === '__add__') {
      const name = window.prompt('추가할 카테고리 이름을 입력하세요');
      if (name && name.trim()) {
        const res = await fetch('/api/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() })
        });
        const json = await res.json();
        if (!res.ok) alert(json.error || '카테고리 추가에 실패했어요.');
      }
      await refresh();
      return;
    }

    if (value === '__manage__') {
      openCategoryManageModal();
      await refresh();
      return;
    }

    state.postsCategoryFilter = value;
    if (state.data) {
      renderCategoryDonutSection(state.data.posts);
      renderPostsTable(state.data);
    }
  });
}

let currentNoteContext = null;

function formatPeriodLabel(period) {
  if (period.length === 7) {
    const [y, m] = period.split('-');
    return `${y}년 ${Number(m)}월`;
  }
  const [y, m, d] = period.split('-');
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
}

function openNoteModal(chartKey, chartLabel, point) {
  currentNoteContext = { chartKey, period: point.date };
  document.getElementById('noteModalPeriod').textContent = `· ${formatPeriodLabel(point.date)}`;
  document.getElementById('noteModalValue').textContent = `${chartLabel} ${point.value.toLocaleString()}`;
  const existing = notesByPeriodFor(chartKey)[point.date] || '';
  const textarea = document.getElementById('noteModalText');
  textarea.value = existing;
  document.getElementById('noteModalDelete').hidden = !existing;
  document.getElementById('noteModal').hidden = false;
  textarea.focus();
}

function closeNoteModal() {
  document.getElementById('noteModal').hidden = true;
  currentNoteContext = null;
}

async function saveCurrentNote(text) {
  if (!currentNoteContext) return;
  await fetch('/api/chart-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...currentNoteContext, text })
  });
  closeNoteModal();
  await refresh();
}

function setupNoteModal() {
  document.getElementById('noteModalClose').addEventListener('click', closeNoteModal);
  document.getElementById('noteModal').addEventListener('click', (e) => {
    if (e.target.id === 'noteModal') closeNoteModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('noteModal').hidden) closeNoteModal();
  });
  document.getElementById('noteModalSave').addEventListener('click', () => {
    saveCurrentNote(document.getElementById('noteModalText').value);
  });
  document.getElementById('noteModalDelete').addEventListener('click', () => {
    saveCurrentNote('');
  });
}

function openCategoryManageModal() {
  renderCategoryManageList();
  document.getElementById('categoryModal').hidden = false;
}

function closeCategoryManageModal() {
  document.getElementById('categoryModal').hidden = true;
}

function renderCategoryManageList() {
  const list = document.getElementById('categoryManageList');
  const categories = state.data?.categories || [];

  list.innerHTML =
    categories
      .map(
        (c) => `
      <div class="category-manage-row">
        <span class="category-manage-name">${escapeHtml(c)}</span>
        <button type="button" class="btn-ghost category-rename-btn" data-name="${escapeHtml(c)}">이름 변경</button>
        <button type="button" class="btn-ghost category-delete-btn" data-name="${escapeHtml(c)}">삭제</button>
      </div>`
      )
      .join('') || '<div class="category-manage-empty">등록된 카테고리가 없어요.</div>';

  list.querySelectorAll('.category-rename-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const oldName = btn.dataset.name;
      const newName = window.prompt(`"${oldName}"의 새 이름을 입력하세요`, oldName);
      if (!newName || !newName.trim() || newName.trim() === oldName) return;
      const res = await fetch(`/api/categories/${encodeURIComponent(oldName)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: newName.trim() })
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || '이름 변경에 실패했어요.');
        return;
      }
      await refresh();
      renderCategoryManageList();
    });
  });

  list.querySelectorAll('.category-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      if (!confirm(`"${name}" 카테고리를 삭제할까요? 이 카테고리로 지정된 게시물은 미지정으로 바뀌어요.`)) return;
      const res = await fetch(`/api/categories/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || '삭제에 실패했어요.');
        return;
      }
      await refresh();
      renderCategoryManageList();
    });
  });
}

function setupCategoryManageModal() {
  document.getElementById('categoryModalClose').addEventListener('click', closeCategoryManageModal);
  document.getElementById('categoryModal').addEventListener('click', (e) => {
    if (e.target.id === 'categoryModal') closeCategoryManageModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('categoryModal').hidden) closeCategoryManageModal();
  });
  document.getElementById('categoryAddForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('categoryAddInput');
    const name = input.value.trim();
    if (!name) return;
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || '카테고리 추가에 실패했어요.');
      return;
    }
    input.value = '';
    await refresh();
    renderCategoryManageList();
  });
}

function openManualPostModal() {
  const form = document.getElementById('manualPostForm');
  form.reset();
  document.getElementById('mpTimestamp').value = new Date().toISOString().slice(0, 10);

  const categorySelect = document.getElementById('mpCategory');
  const categories = state.data?.categories || [];
  categorySelect.innerHTML =
    `<option value="">${CATEGORY_PLACEHOLDER}</option>` + categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  document.getElementById('manualPostModal').hidden = false;
}

function closeManualPostModal() {
  document.getElementById('manualPostModal').hidden = true;
}

function setupManualPostModal() {
  document.getElementById('addManualPostBtn').addEventListener('click', openManualPostModal);
  document.getElementById('manualPostModalClose').addEventListener('click', closeManualPostModal);
  document.getElementById('manualPostModal').addEventListener('click', (e) => {
    if (e.target.id === 'manualPostModal') closeManualPostModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('manualPostModal').hidden) closeManualPostModal();
  });

  document.getElementById('manualPostForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const isCollab = document.getElementById('mpIsCollab').checked;
    const res = await fetch('/api/manual-posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: document.getElementById('mpTimestamp').value,
        media_type: document.getElementById('mpMediaType').value,
        category: document.getElementById('mpCategory').value || null,
        caption: document.getElementById('mpCaption').value,
        like_count: document.getElementById('mpLikes').value,
        comments_count: document.getElementById('mpComments').value,
        saved: document.getElementById('mpSaved').value,
        shares: document.getElementById('mpShares').value,
        reposts: document.getElementById('mpReposts').value,
        profile_visits: document.getElementById('mpProfileVisits').value,
        follows: document.getElementById('mpFollows').value,
        reach: document.getElementById('mpReach').value,
        views: document.getElementById('mpViews').value,
        permalink: document.getElementById('mpPermalink').value,
        thumbnail_url: document.getElementById('mpThumbnail').value,
        is_collab: isCollab,
        collab_partner: isCollab ? document.getElementById('mpCollabPartner').value : ''
      })
    });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || '게시물 추가에 실패했어요.');
      return;
    }
    closeManualPostModal();
    await refresh();
  });
}

function setupModal() {
  document.getElementById('postModalClose').addEventListener('click', closePostModal);
  document.getElementById('postModal').addEventListener('click', (e) => {
    if (e.target.id === 'postModal') closePostModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePostModal();
  });
}

function activateTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tab;
  });
  // 차트가 들어있는 탭을 새로 보여줄 때 Chart.js가 숨겨진 캔버스 크기를 못 읽어
  // 찌그러지는 문제가 있어, 탭 전환 직후 관련 차트를 다시 리사이즈해준다.
  if (tab === 'details') {
    [
      followerChartInstance,
      trendChartInstances.views,
      trendChartInstances.reach,
      categoryChartInstance,
      ageChartInstance
    ].forEach((chart) => chart && chart.resize());
  }
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
}

function setupTrendGranularityControls() {
  document.getElementById('reachGranularity').addEventListener('change', (e) => {
    if (state.data)
      renderReachOnlyChart(state.data.history, e.target.value, notesByPeriodFor('reach'), makePointClickHandler('reach', '도달', 'reach'));
  });

  // 카테고리별 참여율을 전체 참여율이 아니라 좋아요/댓글/저장/공유/리포스트 중 하나만 놓고
  // 볼 수 있게 하는 드롭다운. 이미 열려있는 게시물 목록도 같은 기준으로 다시 정렬한다.
  document.getElementById('categoryMetricSelect').addEventListener('change', (e) => {
    state.categoryEngagementMetric = e.target.value;
    if (state.data) renderCategoryEngagementSection(state.data.posts);
  });
}

async function init() {
  setupSortableHeaders();
  setupModal();
  setupNoteModal();
  setupCategoryManageModal();
  setupManualPostModal();
  setupTabs();
  setupTrendGranularityControls();
  setupAdCampaignForm();
  setupAdSortableHeaders();
  await refresh();

  document.getElementById('syncBtn').addEventListener('click', async () => {
    const btn = document.getElementById('syncBtn');
    btn.disabled = true;
    btn.textContent = '동기화 중...';
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || '동기화에 실패했어요.');
      } else {
        await refresh();
        if (json.remotePush && !json.remotePush.ok) {
          alert(
            `로컬 동기화는 성공했지만, 배포 사이트로 자동 전송은 실패했어요: ${json.remotePush.error}\n\n터미널에서 npm run push-remote 로 다시 시도해주세요.`
          );
        }
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '지금 동기화';
    }
  });
}

init();
