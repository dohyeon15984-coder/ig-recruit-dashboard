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
  if (!pairs.length) return { total: null, delta: null, isPartial: false };
  const sorted = [...pairs].sort((a, b) => a[0].localeCompare(b[0]));
  const months = [...new Set(sorted.map(([d]) => d.slice(0, 7)))];
  const currentMonth = months[months.length - 1];
  const priorMonth = months[months.length - 2];

  const currentRows = sorted.filter(([d]) => d.slice(0, 7) === currentMonth);
  const total = currentRows.reduce((sum, [, v]) => sum + v, 0);
  if (!priorMonth) return { total, delta: null, isPartial: false };

  const lastDay = Math.max(...currentRows.map(([d]) => Number(d.slice(8, 10))));
  const priorRows = sorted.filter(([d]) => d.slice(0, 7) === priorMonth);
  const priorMonthLastDay = Math.max(...priorRows.map(([d]) => Number(d.slice(8, 10))));
  const priorRowsInRange = priorRows.filter(([d]) => Number(d.slice(8, 10)) <= lastDay);

  // 지난달 같은 기간에 데이터가 아예 없으면(예: 동기화가 그 기간엔 없었음) 0과 비교하는 셈이 되어
  // "+100%"처럼 실제와 다른 증감으로 보일 수 있다 — 이 경우 비교 자체를 하지 않는다.
  if (!priorRowsInRange.length) return { total, delta: null, isPartial: lastDay < priorMonthLastDay };

  const priorComparable = priorRowsInRange.reduce((sum, [, v]) => sum + v, 0);
  return { total, delta: total - priorComparable, isPartial: lastDay < priorMonthLastDay };
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
      <div class="follower-hero-value">${current != null ? current.toLocaleString() : '-'}</div>
      ${
        delta != null
          ? `<div class="hero-delta ${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : ''}${delta.toLocaleString()}명 전월 대비</div>`
          : ''
      }
    </div>
    ${delta == null ? '<div class="hero-empty">한 달 이상 데이터가 쌓이면 전월 대비 증감이 표시돼요.</div>' : ''}
    <div class="hero-stat-meaning">월 단위 집계</div>
  `;
}

function renderMonthlyStatHero(elId, title, meaning, pairs) {
  const el = document.getElementById(elId);
  const { total, delta, isPartial } = monthlySumFairCompare(pairs);

  el.innerHTML = `
    <div class="hero-title">${title} <span class="hero-title-note">— ${meaning}</span></div>
    <div class="hero-value-row">
      <div class="follower-hero-value">${total != null ? Math.round(total).toLocaleString() : '-'}</div>
      ${
        delta != null
          ? `<div class="hero-delta ${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : ''}${Math.round(delta).toLocaleString()} ${isPartial ? '지난달 같은 기간 대비' : '전월 대비'}</div>`
          : ''
      }
    </div>
    <div class="hero-stat-meaning">${isPartial ? '월 단위 집계 (이번 달 진행 중)' : '월 단위 집계'}</div>
  `;
}

function renderViewsMonthlyHero(data) {
  const pairs = data.posts.filter((p) => p.views != null).map((p) => [p.timestamp.slice(0, 10), p.views]);
  renderMonthlyStatHero('viewsMonthlyHero', '조회수', '이번 달 노출된 총 횟수', pairs);
}

function renderReachMonthlyHero(data) {
  const pairs = data.history.filter((h) => h.reach != null).map((h) => [h.date, h.reach]);
  renderMonthlyStatHero('reachMonthlyHero', '도달수', '이번 달 본 사람 수(중복 제외)', pairs);
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
          <div><div class="hero-stat-value">${(latest.reach || 0).toLocaleString()}</div><div class="hero-stat-label">도달</div><div class="hero-stat-meaning">본 사람 수(중복 제외)</div></div>
        </div>
        <div class="hero-stats-row hero-stats-row-secondary">
          <div><div class="hero-stat-value-sm">${(latest.like_count || 0).toLocaleString()}</div><div class="hero-stat-label">좋아요</div></div>
          <div><div class="hero-stat-value-sm">${(latest.saved || 0).toLocaleString()}</div><div class="hero-stat-label">저장</div></div>
          <div><div class="hero-stat-value-sm">${(latest.shares || 0).toLocaleString()}</div><div class="hero-stat-label">공유</div></div>
          <div><div class="hero-stat-value-sm">${(latest.comments_count || 0).toLocaleString()}</div><div class="hero-stat-label">댓글</div></div>
        </div>
        <div class="hero-engagement-row">
          <span class="hero-engagement-value">참여율 ${(er * 100).toFixed(1)}%</span>
          <span class="hero-engagement-note">— 도달 대비 얼마나 반응(좋아요·댓글·저장·공유)했는지 보여줘요</span>
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

function sortPosts(posts) {
  const { field, dir } = state.sort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...posts].sort((a, b) => {
    let av = a[field];
    let bv = b[field];
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

// 팔로워 수는 스냅샷 지표라 "그 날짜 기준 팔로워 수"는 그 날짜 이전(포함) 가장 최근 값으로 본다.
function followerCountAsOf(history, dateStr) {
  const before = history.filter((h) => h.follower_count != null && h.date <= dateStr).sort((a, b) => a.date.localeCompare(b.date));
  return before.length ? before[before.length - 1].follower_count : null;
}

// 광고 집행 1건의 파생 지표를 계산한다. 도달/참여는 게시물 전체 값을 그대로 쓴다 —
// 메타 광고 API 연동 없이는 "광고로 발생한" 도달/참여만 따로 떼어낼 방법이 없기 때문.
// 팔로워당 비용도 마찬가지로 "그 기간 전체 팔로워 증가분" 기준 근사치다.
function computeAdMetrics(campaign, postsById, history) {
  const post = postsById.get(campaign.postId);
  const days = Math.max(1, Math.round((new Date(campaign.endDate) - new Date(campaign.startDate)) / (24 * 60 * 60 * 1000)) + 1);
  const reach = post ? post.reach || 0 : 0;
  const engagement = post ? (post.like_count || 0) + (post.comments_count || 0) + (post.saved || 0) + (post.shares || 0) : 0;
  const rate = post ? engagementRate(post) : 0;
  const cpm = reach ? (campaign.spend / reach) * 1000 : null;
  const cpe = engagement ? campaign.spend / engagement : null;

  const followerStart = followerCountAsOf(history, campaign.startDate);
  const followerEnd = followerCountAsOf(history, campaign.endDate);
  const followerGrowth = followerStart != null && followerEnd != null ? followerEnd - followerStart : null;
  const costPerFollower = followerGrowth != null && followerGrowth > 0 ? campaign.spend / followerGrowth : null;

  return { post, days, reach, engagement, rate, cpm, cpe, followerGrowth, costPerFollower };
}

function renderAdsSummary(adCampaigns, posts, history) {
  const el = document.getElementById('adsSummaryRow');
  if (!adCampaigns.length) {
    el.innerHTML = '<div class="ad-stat-card"><div class="ad-stat-label">광고 집행 내역</div><div class="ad-stat-value">아직 없어요</div></div>';
    return;
  }

  const postsById = new Map(posts.map((p) => [p.id, p]));
  const totalSpend = adCampaigns.reduce((sum, c) => sum + Number(c.spend || 0), 0);
  let totalReach = 0;
  let totalEngagement = 0;
  adCampaigns.forEach((c) => {
    const m = computeAdMetrics(c, postsById, history);
    totalReach += m.reach;
    totalEngagement += m.engagement;
  });
  const avgCpm = totalReach ? (totalSpend / totalReach) * 1000 : null;
  const avgCpe = totalEngagement ? totalSpend / totalEngagement : null;
  const avgSpendPerPost = totalSpend / adCampaigns.length;

  el.innerHTML = `
    <div class="ad-stat-card"><div class="ad-stat-label">총 광고 집행 건수</div><div class="ad-stat-value">${adCampaigns.length}건</div></div>
    <div class="ad-stat-card"><div class="ad-stat-label">누적 광고비</div><div class="ad-stat-value">${Math.round(totalSpend).toLocaleString()}원</div></div>
    <div class="ad-stat-card"><div class="ad-stat-label">게시물당 평균 광고비</div><div class="ad-stat-value">${Math.round(avgSpendPerPost).toLocaleString()}원</div></div>
    <div class="ad-stat-card"><div class="ad-stat-label">평균 CPM</div><div class="ad-stat-value">${avgCpm != null ? Math.round(avgCpm).toLocaleString() + '원' : '-'}</div></div>
  `;
}

function renderAdCampaignsTable(adCampaigns, posts, history) {
  const tbody = document.getElementById('adCampaignsTableBody');
  if (!adCampaigns.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="caption-cell">아직 등록된 광고 집행 내역이 없어요. 위에서 등록해보세요.</td></tr>';
    return;
  }

  const postsById = new Map(posts.map((p) => [p.id, p]));
  const sorted = [...adCampaigns].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

  tbody.innerHTML = sorted
    .map((c) => {
      const m = computeAdMetrics(c, postsById, history);
      const captionRaw = m.post ? m.post.caption || '(캡션 없음)' : null;
      const postLabel = captionRaw
        ? escapeHtml(captionRaw.slice(0, 24)) + (captionRaw.length > 24 ? '…' : '')
        : '(삭제된 게시물)';
      return `
      <tr>
        <td class="caption-cell">
          ${postLabel}
          ${c.note ? `<div style="font-size:11px;color:var(--text-faint);margin-top:2px;">${escapeHtml(c.note)}</div>` : ''}
        </td>
        <td>${c.startDate} ~ ${c.endDate}</td>
        <td>${m.days}일</td>
        <td>${Math.round(Number(c.spend)).toLocaleString()}원</td>
        <td>${m.reach.toLocaleString()}</td>
        <td>${m.engagement.toLocaleString()}</td>
        <td>${(m.rate * 100).toFixed(1)}%</td>
        <td>${m.cpm != null ? Math.round(m.cpm).toLocaleString() + '원' : '-'}</td>
        <td>${m.cpe != null ? Math.round(m.cpe).toLocaleString() + '원' : '-'}</td>
        <td>${m.costPerFollower != null ? Math.round(m.costPerFollower).toLocaleString() + '원' : '-'}</td>
        <td><button class="ad-delete-btn" data-ad-id="${c.id}">삭제</button></td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('.ad-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 광고 집행 내역을 삭제할까요?')) return;
      await fetch(`/api/ad-campaigns/${btn.dataset.adId}`, { method: 'DELETE' });
      await refresh();
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
  renderAdsSummary(data.adCampaigns || [], data.posts, data.history);
  renderAdCampaignsTable(data.adCampaigns || [], data.posts, data.history);
}

function setupAdCampaignForm() {
  document.getElementById('adCampaignForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const postId = document.getElementById('adPostSelect').value;
    const startDate = document.getElementById('adStartDate').value;
    const endDate = document.getElementById('adEndDate').value;
    const spend = document.getElementById('adSpend').value;
    const note = document.getElementById('adNote').value;
    if (!postId || !startDate || !endDate || !spend) return;

    await fetch('/api/ad-campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, startDate, endDate, spend, note })
    });
    e.target.reset();
    await refresh();
  });
}

function renderPostsTable(data) {
  const tbody = document.getElementById('postsTableBody');
  const sorted = sortPosts(data.posts);
  updateSortArrows();

  const meta = document.getElementById('postsMeta');
  if (data.meta) {
    meta.textContent =
      data.meta.filteredPosts === data.meta.totalPosts
        ? `전체 ${data.meta.totalPosts}개`
        : `전체 ${data.meta.totalPosts}개 중 ${data.meta.filteredPosts}개 표시`;
  }

  tbody.innerHTML = sorted
    .map((p) => {
      const options = data.categories
        .map((c) => `<option value="${c}" ${p.category === c ? 'selected' : ''}>${c}</option>`)
        .join('');
      return `
      <tr data-post-id="${p.id}">
        <td>${thumbHtml(p, 'row-thumb')}</td>
        <td>${new Date(p.timestamp).toLocaleDateString('ko-KR')}</td>
        <td class="caption-cell">${escapeHtml(p.caption || '').slice(0, 60)}</td>
        <td>${MEDIA_TYPE_LABEL[p.media_type] || p.media_type}${p.is_collab ? ' · 공동' : ''}</td>
        <td>
          <select class="tag-select" data-post-id="${p.id}">
            <option value="">${CATEGORY_PLACEHOLDER}</option>
            ${options}
          </select>
        </td>
        <td>${(p.like_count || 0).toLocaleString()}</td>
        <td>${(p.comments_count || 0).toLocaleString()}</td>
        <td>${(p.saved || 0).toLocaleString()}</td>
        <td>${(p.shares || 0).toLocaleString()}</td>
        <td>${(p.reach || 0).toLocaleString()}</td>
      </tr>`;
    })
    .join('');

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
    ${thumbHtml(post, 'modal-thumb')}
    <div class="modal-title">${escapeHtml(post.caption || '(캡션 없음)')}</div>
    <div class="modal-meta">
      ${new Date(post.timestamp).toLocaleString('ko-KR')} · ${MEDIA_TYPE_LABEL[post.media_type] || post.media_type}${post.is_collab ? ' · 공동 게시물' : ''}${post.category ? ' · ' + post.category : ' · 카테고리 미지정'}
    </div>
    <div class="modal-stats">
      <div class="modal-stat">
        <div class="modal-stat-label">참여율</div>
        <div class="modal-stat-value">${(er * 100).toFixed(1)}%</div>
        <div class="modal-stat-formula">(좋아요+댓글+저장+공유) ÷ 도달</div>
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
    </div>
    <div class="modal-note">참여율은 도달한 사람 중 얼마나 많은 반응(좋아요·댓글·저장·공유)을 이끌어냈는지를 보여줘요. 숫자가 높을수록 도달 대비 콘텐츠 반응이 좋았다는 뜻이에요.</div>
    ${post.permalink && post.permalink !== '#' ? `<a class="modal-link" href="${post.permalink}" target="_blank" rel="noopener">인스타그램에서 보기 →</a>` : ''}
  `;
  modal.hidden = false;
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
  renderViewsOnlyChart(
    data.posts,
    document.getElementById('viewsGranularity')?.value || 'monthly',
    notesByPeriodFor('views'),
    makePointClickHandler('views', '조회수', 'views')
  );
  renderReachOnlyChart(
    data.history,
    document.getElementById('reachGranularity')?.value || 'monthly',
    notesByPeriodFor('reach'),
    makePointClickHandler('reach', '도달', 'reach')
  );
  renderMediaTypeChart(data.posts);
  renderCategoryChart(data.posts);
}

function setupSortableHeaders() {
  document.querySelectorAll('#postsTable th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (state.sort.field === field) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = { field, dir: 'desc' };
      }
      renderPostsTable(state.data);
    });
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
      mediaTypeChartInstance,
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
  document.getElementById('viewsGranularity').addEventListener('change', (e) => {
    if (state.data)
      renderViewsOnlyChart(state.data.posts, e.target.value, notesByPeriodFor('views'), makePointClickHandler('views', '조회수', 'views'));
  });
  document.getElementById('reachGranularity').addEventListener('change', (e) => {
    if (state.data)
      renderReachOnlyChart(state.data.history, e.target.value, notesByPeriodFor('reach'), makePointClickHandler('reach', '도달', 'reach'));
  });
}

async function init() {
  setupSortableHeaders();
  setupModal();
  setupNoteModal();
  setupTabs();
  setupTrendGranularityControls();
  setupAdCampaignForm();
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
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '지금 동기화';
    }
  });
}

init();
