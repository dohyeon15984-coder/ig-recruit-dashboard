const express = require('express');
const { DEMO_POSTS, DEMO_HISTORY, DEMO_ACCOUNT, DEMO_SETTINGS, DEMO_DEMOGRAPHICS } = require('../lib/sampleData');
const { generateInsights } = require('../lib/insights');
const { computeFunnel, computeGoalProgress } = require('../lib/metrics');
const { filterPosts, filterHistory } = require('../lib/filters');
const store = require('../lib/store');
const instagramApi = require('../lib/instagramApi');
const { CATEGORIES } = require('../lib/categories');

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

  const allPosts = live ? store.loadPosts() : DEMO_POSTS;
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
    account,
    history,
    posts,
    settings,
    funnel: computeFunnel(history, posts),
    goal: computeGoalProgress(settings, allHistory),
    demographics: live ? store.loadDemographics() : DEMO_DEMOGRAPHICS,
    insights: generateInsights(posts, history, settings),
    categories: CATEGORIES,
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

    res.json(buildDashboardPayload());
  } catch (err) {
    console.error('[sync] 동기화 실패:', err);
    res.status(502).json({ error: `Instagram API 동기화 실패: ${err.message}` });
  }
});

router.post('/posts/:id/tag', (req, res) => {
  const { category } = req.body || {};
  if (category !== null && !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `유효하지 않은 카테고리입니다. 사용 가능: ${CATEGORIES.join(', ')}` });
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

module.exports = router;
