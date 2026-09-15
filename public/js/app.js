const CATEGORY_PLACEHOLDER = '미지정';

const GENDER_LABEL = { F: '여성', M: '남성', U: '미공개' };
const PERSON_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>';
const PERSON_ICON_FULL_SVG =
  '<svg viewBox="0 0 24 24" width="52" height="52" fill="currentColor"><circle cx="12" cy="4.5" r="2.5"/><path d="M12 8.5c-2.8 0-5 1.6-5 4.2V15h2v6.5h6V15h2v-2.3c0-2.6-2.2-4.2-5-4.2z"/></svg>';

// 날짜별 이력을 월 단위로 묶어(같은 달이면 가장 최근 날짜 값 사용) 한 달=한 포인트로 만든다.
// 팔로워 수처럼 "월 단위로 보고 싶다"고 정한 지표에 사용 — 매일 동기화해도 그래프/KPI가 월별로 유지된다.
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

function renderFollowerHero(data) {
  const el = document.getElementById('followerHero');
  const monthly = monthlyBucketed(data.history, 'follower_count');
  const latestMonth = monthly[monthly.length - 1];
  const prevMonth = monthly[monthly.length - 2];
  const delta = latestMonth && prevMonth ? latestMonth.follower_count - prevMonth.follower_count : null;
  const current = data.account && data.account.followers_count != null ? data.account.followers_count : latestMonth?.follower_count;

  el.innerHTML = `
    <div class="hero-title">현재 팔로워</div>
    <div class="follower-hero-body">
      <div class="follower-hero-icon">${PERSON_ICON_FULL_SVG}</div>
      <div>
        <div class="follower-hero-value">${current != null ? current.toLocaleString() : '-'}</div>
        ${
          delta != null
            ? `<div class="hero-delta ${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : ''}${delta.toLocaleString()}명 전월 대비</div>`
            : '<div class="hero-empty">한 달 이상 데이터가 쌓이면 전월 대비 증감이 표시돼요.</div>'
        }
      </div>
    </div>
  `;
}

function renderSideKpis(data) {
  const grid = document.getElementById('sideKpiGrid');
  const monthlyPV = monthlyBucketed(data.history, 'profile_views');
  const latestPV = monthlyPV[monthlyPV.length - 1];
  const prevPV = monthlyPV[monthlyPV.length - 2];
  const pvDelta = latestPV && prevPV ? latestPV.profile_views - prevPV.profile_views : null;

  grid.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">프로필 방문</div>
      <div class="kpi-value">${latestPV ? latestPV.profile_views.toLocaleString() : '-'}</div>
      ${
        pvDelta != null
          ? `<div class="kpi-delta ${pvDelta >= 0 ? 'pos' : 'neg'}">${pvDelta >= 0 ? '+' : ''}${pvDelta.toLocaleString()} 전월 대비</div>`
          : '<div class="kpi-delta">월 단위 집계</div>'
      }
    </div>
    <div class="kpi-card">
      <div class="kpi-label">게시물 수 (선택 필터 기준)</div>
      <div class="kpi-value">${data.posts.length}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">팔로우 전환율</div>
      <div class="kpi-value">${data.funnel && data.funnel.followConversionRate != null ? (data.funnel.followConversionRate * 100).toFixed(2) + '%' : '-'}</div>
      <div class="kpi-delta">신규 팔로워 / 도달 (선택 구간)</div>
    </div>
  `;
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

function renderReelsComparison(posts) {
  const panel = document.getElementById('reelsComparisonPanel');
  const reels = posts.filter((p) => p.is_reel);
  const feed = posts.filter((p) => !p.is_reel);

  if (!reels.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const avg = (arr, fn) => (arr.length ? arr.reduce((sum, p) => sum + fn(p), 0) / arr.length : 0);
  const rows = [
    { label: '평균 참여율', reel: avg(reels, engagementRate) * 100, feed: avg(feed, engagementRate) * 100, suffix: '%' },
    { label: '평균 저장률', reel: avg(reels, saveRate) * 100, feed: avg(feed, saveRate) * 100, suffix: '%' },
    { label: '평균 도달', reel: avg(reels, (p) => p.reach || 0), feed: avg(feed, (p) => p.reach || 0), suffix: '' }
  ];

  document.getElementById('reelsCompareBody').innerHTML = `
    <div class="reels-compare-note">
      릴스 ${reels.length}개 · 피드 게시물(이미지+카드뉴스) ${feed.length}개 기준
      ${reels.length < 5 ? ' — 릴스 표본이 적어 참고용으로만 봐주세요.' : ''}
    </div>
    <table class="reels-compare-table">
      <thead><tr><th></th><th>🎬 릴스</th><th>🖼️ 피드</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr><td>${r.label}</td><td>${r.reel.toFixed(1)}${r.suffix}</td><td>${r.feed.toFixed(1)}${r.suffix}</td></tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
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
    <div class="hero-title">최신 게시물 성과 · ${new Date(latest.timestamp).toLocaleDateString('ko-KR')} 게시 <span class="hero-title-note">(가장 최근에 올린 게시물 1건 기준)</span></div>
    <div class="hero-body-row">
      <div class="hero-content">
        <div class="hero-stats-row">
          <div><div class="hero-stat-value">${(latest.views || latest.reach || 0).toLocaleString()}</div><div class="hero-stat-label">조회수</div></div>
          <div><div class="hero-stat-value">${(latest.like_count || 0).toLocaleString()}</div><div class="hero-stat-label">좋아요</div></div>
          <div><div class="hero-stat-value">${(latest.comments_count || 0).toLocaleString()}</div><div class="hero-stat-label">댓글</div></div>
        </div>
        <div class="hero-engagement-row">
          <span class="hero-engagement-value">참여율 ${(er * 100).toFixed(1)}%</span>
          <span class="hero-engagement-note">— 도달 대비 얼마나 반응(좋아요·댓글·저장·공유)했는지 보여줘요</span>
        </div>
        <div class="hero-stats-row hero-stats-row-secondary">
          <div><div class="hero-stat-value-sm">${(latest.saved || 0).toLocaleString()}</div><div class="hero-stat-label">저장</div></div>
          <div><div class="hero-stat-value-sm">${(latest.shares || 0).toLocaleString()}</div><div class="hero-stat-label">공유</div></div>
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
    <div class="hero-title">도달 추이 (최근 7일 합계)</div>
    <div class="hero-stats-row">
      <div><div class="hero-stat-value">${cmp.lastSum.toLocaleString()}</div><div class="hero-stat-label">최근 7일 도달</div></div>
      ${
        cmp.pct != null
          ? `<div class="hero-delta ${cmp.pct >= 0 ? 'pos' : 'neg'}">${cmp.pct >= 0 ? '+' : ''}${cmp.pct.toFixed(0)}% 이전 7일 대비</div>`
          : ''
      }
    </div>
    <div class="hero-chart-caption">일별 도달 (최근 14일, 막대에 마우스를 올리면 날짜별 수치가 보여요)</div>
    <div class="hero-chart-wrap"><canvas id="reachHeroChart"></canvas></div>
  `;
  renderReachSparkline(withReach.slice(-14));
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
        <td>${MEDIA_TYPE_LABEL[p.media_type] || p.media_type}</td>
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
      ${new Date(post.timestamp).toLocaleString('ko-KR')} · ${MEDIA_TYPE_LABEL[post.media_type] || post.media_type}${post.category ? ' · ' + post.category : ' · 카테고리 미지정'}
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

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeekCount = posts.filter((p) => new Date(p.timestamp).getTime() >= weekAgo).length;

  const byCategory = new Map();
  posts
    .filter((p) => p.category)
    .forEach((p) => {
      if (!byCategory.has(p.category)) byCategory.set(p.category, []);
      byCategory.get(p.category).push(p);
    });
  let topCategory = '-';
  let topRate = -1;
  byCategory.forEach((arr, cat) => {
    const rate = arr.reduce((sum, p) => sum + engagementRate(p), 0) / arr.length;
    if (rate > topRate) {
      topRate = rate;
      topCategory = cat;
    }
  });

  container.innerHTML = `
    <div class="quick-stat-row"><span>마지막 게시</span><strong>${daysSinceLast === 0 ? '오늘' : daysSinceLast + '일 전'}</strong></div>
    <div class="quick-stat-row"><span>이번 주 게시</span><strong>${thisWeekCount}건</strong></div>
    <div class="quick-stat-row"><span>최다반응 카테고리</span><strong>${escapeHtml(topCategory)}</strong></div>
  `;
}

function renderAll(data) {
  renderModeBadgeAndBanner(data);
  renderFollowerHero(data);
  renderSideKpis(data);
  renderPostCalendar(data.posts);
  renderQuickStats(data.posts);
  renderLatestPostHero(data.posts);
  renderReachHero(data.history);
  renderDemographics(data);
  renderReelsComparison(data.posts);
  renderInsights(data.insights);
  renderTopPosts(data.posts);
  renderRecentThumbs(data.posts);
  renderPostsTable(data);
  renderFollowerChart(monthlyBucketed(data.history, 'follower_count'));
  renderReachChart(data.history);
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
    [followerChartInstance, reachChartInstance, mediaTypeChartInstance, categoryChartInstance, ageChartInstance].forEach(
      (chart) => chart && chart.resize()
    );
  }
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
}

async function init() {
  setupSortableHeaders();
  setupModal();
  setupTabs();
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
