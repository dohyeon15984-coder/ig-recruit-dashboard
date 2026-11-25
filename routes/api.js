const express = require('express');
const { DEMO_POSTS, DEMO_HISTORY, DEMO_ACCOUNT, DEMO_SETTINGS, DEMO_DEMOGRAPHICS } = require('../lib/sampleData');
const { generateInsights } = require('../lib/insights');
const { computeFunnel, computeGoalProgress } = require('../lib/metrics');
const { filterPosts, filterHistory } = require('../lib/filters');
const store = require('../lib/store');
const instagramApi = require('../lib/instagramApi');
const { pushToRemote } = require('../lib/pushToRemote');
const { generateInsight } = require('../lib/aiInsight');

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
    aiInsight: store.loadAiInsight(),
    aiInsightEnabled: Boolean(process.env.ANTHROPIC_API_KEY) && process.env.SYNC_DISABLED !== 'true',
    // 관리자 PC(로컬)에서만 "열람자 관리" 버튼을 보여준다.
    viewerAdmin: process.env.AUTH_REQUIRED !== 'true' && process.env.SYNC_DISABLED !== 'true' && Boolean(process.env.REMOTE_DASHBOARD_URL),
    meta: { totalPosts: allPosts.length, filteredPosts: posts.length }
  };
}

router.get('/dashboard', (req, res) => {
  res.json({ ...buildDashboardPayload(req.query), authUser: req.authUser || null });
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

// "새로운 AI 인사이트": 현재 데이터를 Claude에게 보내 채용분석관 리포트를 새로 받아 저장한다.
// 호출할 때마다 API 요금이 나가므로 공유용 사이트에서는 막고(키도 안 둔다), 로컬 PC에서만 동작한다.
router.post('/ai-insight', async (req, res) => {
  if (process.env.SYNC_DISABLED === 'true') {
    return res.status(400).json({ error: '새 분석은 로컬 PC의 대시보드에서만 만들 수 있어요. 로컬에서 만들면 이 사이트에도 자동으로 전달돼요.' });
  }
  try {
    const live = isLiveMode();
    const insight = await generateInsight({
      posts: live ? store.applyPostCollabInfo(store.applyPostOverrides([...store.loadPosts(), ...store.loadManualPosts()])) : DEMO_POSTS,
      history: live ? store.loadHistory() : DEMO_HISTORY,
      adCampaigns: store.loadAdCampaigns(),
      categories: store.loadCategories()
    });
    store.saveAiInsight(insight);

    let remotePush = null;
    if (process.env.REMOTE_DASHBOARD_URL && process.env.ADMIN_SYNC_SECRET) {
      try {
        await pushToRemote(process.env.REMOTE_DASHBOARD_URL, process.env.ADMIN_SYNC_SECRET);
        remotePush = { ok: true };
      } catch (err) {
        remotePush = { ok: false, error: err.message };
      }
    }
    res.json({ aiInsight: insight, remotePush });
  } catch (err) {
    console.error('[ai-insight] 실패:', err.message);
    res.status(err.code === 'NO_KEY' ? 400 : 502).json({ error: err.message });
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
  const { postId, reach, views, like_count, comments_count, saved, shares, reposts, profile_visits, follows } = req.body || {};
  if (!postId) return res.status(400).json({ error: 'postId가 필요해요.' });
  const overrides = store.savePostOverride(postId, { reach, views, like_count, comments_count, saved, shares, reposts, profile_visits, follows });
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

  // 프로필 방문/팔로우는 모르면 비워둘 수 있어서 빈 값은 null(표에서 "-")로 저장한다.
  for (const key of ['profile_visits', 'follows']) {
    const raw = req.body?.[key];
    const n = raw === '' || raw == null ? NaN : Number(raw);
    record[key] = Number.isFinite(n) ? n : null;
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

// 게시물 유료 광고 집행 내역 CRUD. 메타 마케팅 API 연동 없이, 인스타그램 앱 인사이트의
// "광고" 탭(전체 탭과 별개로 광고 기여분만 보여주는 화면)에서 확인한 값을 사용자가 직접
// 입력해두는 용도 — 게시물 자체의(오가닉+유료 합산) 수치와는 완전히 분리된 광고 전용 값이다.
const AD_METRIC_FIELDS = ['views', 'reach', 'likes', 'saved', 'shares', 'followerGrowth', 'profileVisits'];

router.post('/ad-campaigns', (req, res) => {
  const { id, postId, spend, startDate, endDate, note, ...body } = req.body || {};
  if (!postId || !startDate || !endDate || spend == null) {
    return res.status(400).json({ error: '게시물, 기간, 광고비는 필수예요.' });
  }

  // 신규 등록일 때만 광고 지표 전체를 필수로 요구한다. 기존 건을 표에서 한 칸씩 고칠 때는
  // (예: 아직 못 채운 옛날 데이터) 나머지 값이 없어도 그 필드만 부분 수정할 수 있어야 한다.
  const isNew = !id || !store.loadAdCampaigns().some((c) => c.id === id);
  if (isNew) {
    for (const field of AD_METRIC_FIELDS) {
      if (body[field] == null || body[field] === '') {
        return res.status(400).json({ error: '광고 성과 지표(조회수·도달·좋아요 및 공감·저장·공유·팔로워 증가·프로필 방문)는 모두 필수예요.' });
      }
    }
  }
  const metrics = {};
  for (const field of AD_METRIC_FIELDS) {
    if (body[field] != null && body[field] !== '') metrics[field] = Number(body[field]);
  }

  const record = store.saveAdCampaign({ id, postId, spend: Number(spend), startDate, endDate, note: note || '', ...metrics });
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
// ---------- 공유용 사이트 열람자 관리 ----------
function checkAdminSecret(req, res) {
  const secret = process.env.ADMIN_SYNC_SECRET;
  if (!secret) {
    res.status(404).json({ error: '이 기능이 활성화되지 않았어요 (ADMIN_SYNC_SECRET 미설정).' });
    return false;
  }
  if (req.get('x-admin-secret') !== secret) {
    res.status(401).json({ error: '인증에 실패했어요.' });
    return false;
  }
  return true;
}

// [공유 사이트] 대기 중인 열람 신청 목록. 로컬 PC의 "열람자 관리" 화면이 관리자 비밀키로 가져간다.
router.get('/admin/access-requests', (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  res.json({ requests: store.loadAccessRequests() });
});

// [로컬 PC 전용] 열람자 관리. 공유 사이트(인증 켜짐/동기화 꺼짐)에서는 막는다.
function localOnly(req, res, next) {
  if (process.env.AUTH_REQUIRED === 'true' || process.env.SYNC_DISABLED === 'true') {
    return res.status(403).json({ error: '열람자 관리는 관리자 PC의 로컬 대시보드에서만 할 수 있어요.' });
  }
  if (!process.env.REMOTE_DASHBOARD_URL || !process.env.ADMIN_SYNC_SECRET) {
    return res.status(400).json({ error: '.env에 REMOTE_DASHBOARD_URL과 ADMIN_SYNC_SECRET이 필요해요.' });
  }
  next();
}

async function fetchRemoteRequests() {
  const url = process.env.REMOTE_DASHBOARD_URL.replace(/\/$/, '') + '/api/admin/access-requests';
  const r = await fetch(url, { headers: { 'x-admin-secret': process.env.ADMIN_SYNC_SECRET } });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || `공유 사이트 응답 실패 (${r.status})`);
  return json.requests || [];
}

const publicViewer = (v) => ({ id: v.id, name: v.name, dept: v.dept, email: v.email, approvedAt: v.approvedAt });
const publicRequest = (r) => ({ id: r.id, name: r.name, dept: r.dept, email: r.email, requestedAt: r.requestedAt });

async function pendingRequests() {
  const resolved = new Set(store.loadResolvedRequestIds());
  return (await fetchRemoteRequests()).filter((r) => !resolved.has(r.id));
}

router.get('/viewers', localOnly, async (req, res) => {
  const viewers = store.loadViewers().filter((v) => !v.revokedAt).map(publicViewer);
  try {
    res.json({ viewers, requests: (await pendingRequests()).map(publicRequest) });
  } catch (err) {
    res.json({ viewers, requests: [], remoteError: err.message });
  }
});

// 사이드바 "열람자 관리" 버튼의 알림 숫자용: 대기 중인 신청 수만 돌려준다.
router.get('/viewers/pending-count', localOnly, async (req, res) => {
  try {
    res.json({ count: (await pendingRequests()).length });
  } catch (err) {
    res.json({ count: null, remoteError: err.message });
  }
});

async function pushAndReport(res, extra = {}) {
  try {
    await pushToRemote(process.env.REMOTE_DASHBOARD_URL, process.env.ADMIN_SYNC_SECRET);
    res.json({ ok: true, pushed: true, ...extra });
  } catch (err) {
    res.json({ ok: true, pushed: false, pushError: err.message, ...extra });
  }
}

router.post('/viewers/approve', localOnly, async (req, res) => {
  let requests;
  try {
    requests = await pendingRequests();
  } catch (err) {
    return res.status(502).json({ error: '공유 사이트에서 신청 목록을 가져오지 못했어요: ' + err.message });
  }
  const r = requests.find((x) => x.id === req.body?.requestId);
  if (!r) return res.status(404).json({ error: '신청을 찾지 못했어요. 목록을 새로고침해주세요.' });
  const viewers = store.loadViewers().filter((v) => v.email !== r.email);
  viewers.push({
    id: 'v_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: r.name,
    dept: r.dept,
    email: r.email,
    pinHash: r.pinHash,
    requestedAt: r.requestedAt,
    approvedAt: new Date().toISOString()
  });
  store.saveViewers(viewers);
  store.addResolvedRequestId(r.id);
  await pushAndReport(res);
});

router.post('/viewers/reject', localOnly, async (req, res) => {
  if (!req.body?.requestId) return res.status(400).json({ error: 'requestId가 필요해요.' });
  store.addResolvedRequestId(req.body.requestId);
  if (!store.loadViewers().length) store.saveViewers([]); // 목록 파일이 있어야 공유 사이트로 전송된다
  await pushAndReport(res);
});

router.post('/viewers/revoke', localOnly, async (req, res) => {
  const before = store.loadViewers();
  const after = before.filter((v) => v.id !== req.body?.id);
  if (after.length === before.length) return res.status(404).json({ error: '열람자를 찾지 못했어요.' });
  store.saveViewers(after);
  await pushAndReport(res);
});

router.post('/admin/import', (req, res) => {
  const secret = process.env.ADMIN_SYNC_SECRET;
  if (!secret) {
    return res.status(404).json({ error: '이 기능이 활성화되지 않았어요 (ADMIN_SYNC_SECRET 미설정).' });
  }
  if (req.get('x-admin-secret') !== secret) {
    return res.status(401).json({ error: '인증에 실패했어요.' });
  }

  const { posts, history, demographics, chartNotes, adCampaigns, postOverrides, categories, postCollabInfo, manualPosts, aiInsight } =
    req.body || {};
  if (aiInsight && typeof aiInsight === 'object') store.saveAiInsight(aiInsight);
  // 열람자: 승인 목록은 통째로 교체(회수가 바로 반영되도록), 처리된 신청은 대기 목록에서 지운다.
  if (Array.isArray(req.body?.viewers)) store.saveViewers(req.body.viewers);
  if (Array.isArray(req.body?.resolvedRequestIds) && req.body.resolvedRequestIds.length) {
    const done = new Set(req.body.resolvedRequestIds);
    store.saveAccessRequests(store.loadAccessRequests().filter((r) => !done.has(r.id)));
  }
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
