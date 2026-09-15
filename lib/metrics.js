// 계정 레벨 "퍼널" 지표. 사용자가 기존에 엑셀로 관리하던 헤드라인 KPI를 그대로 계산한다:
// 팔로우 전환율(신규 팔로워/도달), 도달효율(도달/업로드수), 프로필 방문 효율(프로필 방문/도달).

function engagementRate(post) {
  const base = post.reach || post.views || 0;
  if (!base) return 0;
  const interactions = (post.like_count || 0) + (post.comments_count || 0) + (post.saved || 0) + (post.shares || 0);
  return interactions / base;
}

function saveRate(post) {
  const base = post.reach || post.views || 0;
  return base ? (post.saved || 0) / base : 0;
}

// 주어진 구간(필터가 적용된 history/posts) 전체를 기준으로 퍼널 지표를 계산한다.
// history의 각 스냅샷은 "그 주간의" 도달/프로필방문 값이므로 구간 내 합산이 곧 기간 전체 값이다.
function computeFunnel(history, posts) {
  if (history.length < 2) return null;
  const first = history[0];
  const last = history[history.length - 1];

  // 팔로워 수는 일부 스냅샷(예: 도달만 백필된 날)에는 없을 수 있으므로,
  // 실제 값이 있는 가장 이른/늦은 스냅샷을 따로 찾는다.
  const withFollowers = history.filter((h) => h.follower_count != null);
  const newFollowers =
    withFollowers.length >= 2
      ? withFollowers[withFollowers.length - 1].follower_count - withFollowers[0].follower_count
      : null;

  const periodReach = history.reduce((sum, h) => sum + (h.reach || 0), 0);
  const periodProfileViews = history.reduce((sum, h) => sum + (h.profile_views || 0), 0);

  return {
    periodLabel: `${first.date} ~ ${last.date}`,
    newFollowers,
    followConversionRate: periodReach && newFollowers != null ? newFollowers / periodReach : null,
    reachEfficiencyPerPost: posts.length && periodReach ? periodReach / posts.length : null,
    profileVisitRate: periodReach ? periodProfileViews / periodReach : null,
    postsInPeriod: posts.length
  };
}

function computeGoalProgress(settings, history) {
  const { goalLabel, goalBaselineFollowers, goalTargetNet } = settings || {};
  const withFollowers = history.filter((h) => h.follower_count != null);
  if (!goalTargetNet || goalBaselineFollowers == null || !withFollowers.length) return null;

  const currentFollowers = withFollowers[withFollowers.length - 1].follower_count;
  const netSoFar = currentFollowers - goalBaselineFollowers;
  const achievementPct = (netSoFar / goalTargetNet) * 100;

  return { goalLabel, goalBaselineFollowers, goalTargetNet, netSoFar, achievementPct };
}

module.exports = { engagementRate, saveRate, computeFunnel, computeGoalProgress };
