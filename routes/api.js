const express = require('express');
const { DEMO_POSTS, DEMO_HISTORY, DEMO_ACCOUNT, DEMO_SETTINGS, DEMO_DEMOGRAPHICS } = require('../lib/sampleData');
const { generateInsights } = require('../lib/insights');
const { computeFunnel, computeGoalProgress } = require('../lib/metrics');
const { filterPosts, filterHistory } = require('../lib/filters');
const store = require('../lib/store');
const instagramApi = require('../lib/instagramApi');
const { pushToRemote } = require('../lib/pushToRemote');

const router = express.Router();

function isLiveMode() {
  return Boolean(process.env.IG_ACCESS_TOKEN && process.env.IG_BUSINESS_ACCOUNT_ID);
}

function tokenStatus() {
  if (!process.env.IG_TOKEN_ISSUED_AT) return null;
  const issued = new Date(process.env.IG_TOKEN_ISSUED_AT);
  if (Number.isNaN(issued.getTime())) return null;
  const expiresAt = new Date(issued.getTime() + 60 * 24 * 60 * 60 * 1000);
  const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return { expiresAt: expiresAt.toISOString().slice(0, 10), daysLeft };
}

function buildDashboardPayload(query = {}) {
  const live = isLiveMode();

  const allPosts = live
    ? store.applyPostCollabInfo(store.applyPostOverrides([...store.loadPosts(), ...store.loadManualPosts()]))
    : DEMO_POSTS;
  const allHistory = live ? store.loadHistory() : DEMO_HISTORY;
  const settings = live ? store.loadSettings() : DEMO_SETTINGS;

  const posts = filterPosts(allPosts, query);
  const history = filterHistory(allHistory, query);

  // "현재 팔로워"와 목표 달성률은 조회 필터와 무관하게 항상 계정 전체 최신값을 기준으로 한다.
  const currentFollowers = allHistory.length ? allHistory[allHistory.length - 1].follower_count : null;
  const account = live
    ? currentFollowers != null
      ? { followers_count: currentFollowers }
      : null
    : { ...DEMO_ACCOUNT, followers_count: currentFollowers };

  return {
    mode: live ? 'live' : 'demo',
    tokenStatus: live ? tokenStatus() : null,
    // Render 등 일부 클라우드 호스팅 IP는 Meta가 막아서 배포 서버에서 직접 동기화가 안 될 수 있다.
    // SYNC_DISABLED=true로 배포하면 프론트에서 동기화 버튼을 비활성화하고, 로컬 PC에서
    // scripts/push-to-remote.js로 데이터를 보내도록 안내한다.
    syncDisabled: process.env.SYNC_DISABLED === 'true',
    account,
    history,
    posts,
    settings,
    funnel: computeFunnel(history, posts),
    goal: computeGoalProgress(settings, allHistory),
    demographics: live ? store.loadDemographics() : DEMO_DEMOGRAPHICS,
    chartNotes: store.loadChartNotes(),
    adCampaigns: store.loadAdCampaigns(),
    insights: generateInsights(posts, history, settings),
    categories: store.loadCategories(),
    meta: { totalPosts: allPosts.length, filteredPosts: posts.length }
  };
}

router.get('/dashboard', (req, res) => {
  res.json(buildDashboardPayload(req.query));
});

router.post('/sync', async (req, res) => {
  if (!isLiveMode()) {
    return res.status(400).json({
      error: '데모 모드에서는 동기화할 수 없어요. SETUP.md 안내대로 .env에 실제 토큰을 설정해주세요.'
    });
  }
  if (process.env.SYNC_DISABLED === 'true') {
    return res.status(400).json({
      error: '이 서버에서는 동기화가 꺼져 있어요. 로컬 PC에서 동기화 후 npm run push-remote 로 데이터를 보내주세요.'
    });
  }

  try {
    const { todaySnapshot } = await instagramApi.getAccountSnapshot(
      process.env.IG_BUSINESS_ACCOUNT_ID,
      process.env.IG_ACCESS_TOKEN
    );
    const media = await instagramApi.getRecentMedia(process.env.IG_BUSINESS_ACCOUNT_ID, process.env.IG_ACCESS_TOKEN);
    const dailyBackfill = await instagramApi.getDailyInsightsHistory(
      process.env.IG_BUSINESS_ACCOUNT_ID,
      process.env.IG_ACCESS_TOKEN,
      30
    );
    const demographics = await instagramApi.getFollowerDemographics(
      process.env.IG_BUSINESS_ACCOUNT_ID,
      process.env.IG_ACCESS_TOKEN
    );

    store.mergePosts(media);
    store.mergeHistorySnapshots([...dailyBackfill, todaySnapshot]);
    store.saveDemographics(demographics);

    // 로컬 동기화가 끝나면 배포 서버(Render)로도 자동으로 데이터를 밀어넣는다 — 사용자가
    // "지금 동기화" 버튼 한 번만 눌러도 로컬+배포 사이트가 같이 최신화되도록 하기 위함.
    // 실패해도 로컬 동기화 자체는 이미 성공했으니 에러로 만들지 않고 결과에만 표시한다.
    let remotePush = null;
    if (process.env.REMOTE_DASHBOARD_URL && process.env.ADMIN_SYNC_SECRET) {
      try {
        await pushToRemote(process.env.REMOTE_DASHBOARD_URL, process.env.ADMIN_SYNC_SECRET);
        remotePush = { ok: true };
      } catch (err) {
        console.warn('[sync] 배포 서버로 자동 전송 실패:', err.message);
        remotePush = { ok: false, error: err.message };
      }
    }

    res.json({ ...buildDashboardPayload(), remotePush });
  } catch (err) {
    console.error('[sync] 동기화 실패:', err);
    res.status(502).json({ error: `Instagram API 동기화 실패: ${err.message}` });
  }
});

router.post('/posts/:id/tag', (req, res) => {
  const { category } = req.body || {};
  const categories = store.loadCategories();
  if (category !== null && !categories.includes(category)) {
    return res.status(400).json({ error: `유효하지 않은 카테고리입니다. 사용 가능: ${categories.join(', ')}` });
  }

  if (!isLiveMode()) {
    // 데모 모드에서는 메모리상의 샘플 데이터만 갱신 (재시작 시 초기화됨)
    const post = DEMO_POSTS.find((p) => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '게시물을 찾을 수 없어요.' });
    post.category = category;
    return res.json(post);
  }

  const updated = store.setPostCategory(req.params.id, category);
  if (!updated) return res.status(404).json({ error: '게시물을 찾을 수 없어요.' });
  res.json(updated);
});

// 게시물의 "실제 전체 수치(오가닉+유료 홍보 합산)" 수동 보정. Graph API 기본 인사이트는
// 오가닉 몫만 주기 때문에, 광고를 태운 게시물은 인스타그램 앱에서 보이는 진짜 합산 값을
// 여기로 입력하면 이후 대시보드 전체에 그 값이 반영된다.
router.post('/post-overrides', (req, res) => {
  const { postId, reach, views, like_count, comments_count, saved, shares, reposts } = req.body || {};
  if (!postId) return res.status(400).json({ error: 'postId가 필요해요.' });
  const overrides = store.savePostOverride(postId, { reach, views, like_count, comments_count, saved, shares, reposts });
  res.json({ postOverrides: overrides });
});

router.delete('/post-overrides/:postId', (req, res) => {
  const overrides = store.clearPostOverride(req.params.postId);
  res.json({ postOverrides: overrides });
});

// 공동 게시물(콜라보) 여부와 협업 계정을 수동으로 기록. Meta API로 자동 감지가 막혀있어
// (/tags 엔드포인트 권한 문제, Tech Provider 전환 없이는 해결 불가) 수동 입력으로 대체한다.
router.post('/post-collab', (req, res) => {
  const { postId, isCollab, partner } = req.body || {};
  if (!postId) return res.status(400).json({ error: 'postId가 필요해요.' });
  const info = store.savePostCollabInfo(postId, { isCollab: Boolean(isCollab), partner: partner || '' });
  res.json({ postCollabInfo: info });
});

router.delete('/post-collab/:postId', (req, res) => {
  const info = store.clearPostCollabInfo(req.params.postId);
  res.json({ postCollabInfo: info });
});

// Meta API가 절대 내려주지 않는 게시물(원작성자가 다른 계정인 콜라보 게시물 등)을
// 사용자가 직접 한 건씩 입력해서 "전체 게시물"에 추가하는 기능.
router.post('/manual-posts', (req, res) => {
  const { id, timestamp, caption, media_type, category, is_collab, collab_partner, permalink, thumbnail_url } = req.body || {};
  const numericFields = ['like_count', 'comments_count', 'saved', 'shares', 'reposts', 'reach', 'views'];
  if (!timestamp) return res.status(400).json({ error: '날짜는 필수예요.' });

  const record = {
    id,
    timestamp: new Date(timestamp).toISOString(),
    caption: caption || '',
    media_type: media_type || 'CAROUSEL_ALBUM',
    category: category || null,
    is_collab: Boolean(is_collab),
    collab_partner: is_collab ? (collab_partner || '').trim() : null,
    permalink: permalink || null,
    thumbnail_url: thumbnail_url || null
  };
  for (const key of numericFields) {
    const n = Number(req.body?.[key]);
    record[key] = Number.isFinite(n) ? n : 0;
  }

  const saved = store.saveManualPost(record);
  res.json({ post: saved });
});

router.delete('/manual-posts/:id', (req, res) => {
  const posts = store.deleteManualPost(req.params.id);
  res.json({ manualPosts: posts });
});

// 추이 차트의 특정 시점(예: 튀는 지점)에 왜 그랬는지 메모를 남기는 기능.
router.post('/chart-notes', (req, res) => {
  const { chartKey, period, text } = req.body || {};
  if (!chartKey || !period) {
    return res.status(400).json({ error: 'chartKey와 period가 필요해요.' });
  }
  const notes = store.saveChartNote({ chartKey, period, text });
  res.json({ chartNotes: notes });
});

// 게시물 카테고리(태그 종류) CRUD. 전체 게시물 표의 카테고리 드롭다운에서 바로 관리할 수 있게 한다.
router.post('/categories', (req, res) => {
  const { name } = req.body || {};
  try {
    res.json({ categories: store.addCategory(name) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/categories/:name', (req, res) => {
  const { newName } = req.body || {};
  try {
    res.json({ categories: store.renameCategory(req.params.name, newName) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/categories/:name', (req, res) => {
  res.json({ categories: store.deleteCategory(req.params.name) });
});

// 게시물 유료 광고 집행 내역 CRUD. 메타 광고 API 연동이 아니라, Ads Manager에서
// 직접 확인한 값을 사용자가 수동으로 입력해두는 용도.
router.post('/ad-campaigns', (req, res) => {
  const { id, postId, spend, startDate, endDate, followerGrowth, note } = req.body || {};
  if (!postId || !startDate || !endDate || spend == null || followerGrowth == null || followerGrowth === '') {
    return res.status(400).json({ error: '게시물, 기간, 광고비, 팔로워 증가(광고 기여)는 필수예요.' });
  }
  const record = store.saveAdCampaign({
    id,
    postId,
    spend: Number(spend),
    startDate,
    endDate,
    followerGrowth: Number(followerGrowth),
    note: note || ''
  });
  res.json({ adCampaign: record, adCampaigns: store.loadAdCampaigns() });
});

router.delete('/ad-campaigns/:id', (req, res) => {
  const adCampaigns = store.deleteAdCampaign(req.params.id);
  res.json({ adCampaigns });
});

router.post('/settings', (req, res) => {
  const { goalLabel, goalBaselineFollowers, goalTargetNet } = req.body || {};
  const partial = {
    goalLabel: goalLabel ?? '',
    goalBaselineFollowers: goalBaselineFollowers === '' || goalBaselineFollowers == null ? null : Number(goalBaselineFollowers),
    goalTargetNet: goalTargetNet === '' || goalTargetNet == null ? null : Number(goalTargetNet)
  };

  if (!isLiveMode()) {
    Object.assign(DEMO_SETTINGS, partial);
    return res.json(buildDashboardPayload());
  }

  store.saveSettings(partial);
  res.json(buildDashboardPayload());
});

// Meta가 Render 같은 공용 클라우드 호스팅의 IP를 차단해 배포 서버에서 직접 동기화가 안 되는 경우를 위한
// 우회 경로: 로컬 PC(막히지 않은 IP)에서 동기화한 데이터를 배포 서버로 밀어넣는다.
// scripts/push-to-remote.js 에서 사용 — ADMIN_SYNC_SECRET이 설정된 배포 환경에서만 동작한다.
router.post('/admin/import', (req, res) => {
  const secret = process.env.ADMIN_SYNC_SECRET;
  if (!secret) {
    return res.status(404).json({ error: '이 기능이 활성화되지 않았어요 (ADMIN_SYNC_SECRET 미설정).' });
  }
  if (req.get('x-admin-secret') !== secret) {
    return res.status(401).json({ error: '인증에 실패했어요.' });
  }

  const { posts, history, demographics, chartNotes, adCampaigns, postOverrides, categories, postCollabInfo, manualPosts } =
    req.body || {};
  if (Array.isArray(posts)) store.importPosts(posts);
  if (Array.isArray(history)) store.mergeHistorySnapshots(history);
  if (demographics) store.saveDemographics(demographics);
  if (Array.isArray(chartNotes)) {
    for (const note of chartNotes) store.saveChartNote(note);
  }
  if (Array.isArray(adCampaigns)) {
    for (const campaign of adCampaigns) store.saveAdCampaign(campaign);
  }
  if (postOverrides && typeof postOverrides === 'object') {
    for (const [postId, fields] of Object.entries(postOverrides)) store.savePostOverride(postId, fields);
  }
  if (Array.isArray(categories)) store.saveCategories(categories);
  if (postCollabInfo && typeof postCollabInfo === 'object') {
    for (const [postId, fields] of Object.entries(postCollabInfo)) store.savePostCollabInfo(postId, fields);
  }
  if (Array.isArray(manualPosts)) {
    for (const post of manualPosts) store.saveManualPost(post);
  }

  res.json({ ok: true, importedPosts: posts?.length ?? 0, importedHistory: history?.length ?? 0 });
});

module.exports = router;
