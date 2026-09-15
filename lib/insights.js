// 룰 기반 "AI 인사이트" 엔진. 외부 LLM 없이 통계 규칙으로 한국어 추천 문구를 생성한다.
// 이후 Claude API 키를 연동하면 이 결과를 서술형으로 다듬는 방식으로 확장 가능하다.

const { engagementRate, computeFunnel, computeGoalProgress } = require('./metrics');

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const MEDIA_TYPE_LABEL = { IMAGE: '이미지', VIDEO: '릴스/영상', CAROUSEL_ALBUM: '카드뉴스' };

function average(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function groupBy(posts, keyFn) {
  const groups = new Map();
  for (const post of posts) {
    const key = keyFn(post);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(post);
  }
  return groups;
}

function summarizeGroups(groups) {
  return [...groups.entries()]
    .map(([key, posts]) => ({
      key,
      count: posts.length,
      avgEngagementRate: average(posts.map(engagementRate))
    }))
    .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate);
}

function pct(n) {
  const v = n * 100;
  // 1%p 미만인 값(예: 팔로우 전환율)은 반올림하면 0%로 뭉개지므로 소수점을 살려서 표시
  return Math.abs(v) < 1 ? `${v.toFixed(2)}%` : `${Math.round(v)}%`;
}

function generateInsights(posts, history, settings) {
  const insights = [];
  if (!posts.length) {
    return [{ icon: '💡', title: '데이터가 아직 없어요', description: '게시물을 동기화하면 인사이트가 표시됩니다.' }];
  }

  // 1. 미디어 유형 비교
  const byMediaType = summarizeGroups(groupBy(posts, (p) => p.media_type));
  if (byMediaType.length >= 2 && byMediaType[0].avgEngagementRate > 0) {
    const best = byMediaType[0];
    const worst = byMediaType[byMediaType.length - 1];
    if (worst.avgEngagementRate > 0 && best.key !== worst.key) {
      const diff = (best.avgEngagementRate / worst.avgEngagementRate - 1);
      if (diff > 0.05) {
        insights.push({
          icon: '🎬',
          title: `${MEDIA_TYPE_LABEL[best.key] || best.key} 콘텐츠가 가장 효과적이에요`,
          description: `최근 게시물 기준 ${MEDIA_TYPE_LABEL[best.key] || best.key}의 평균 참여율(${pct(best.avgEngagementRate)})이 ${MEDIA_TYPE_LABEL[worst.key] || worst.key}(${pct(worst.avgEngagementRate)}) 대비 ${pct(diff)} 더 높습니다. 다음 콘텐츠 기획 시 ${MEDIA_TYPE_LABEL[best.key] || best.key} 비중을 늘려보세요.`
        });
      }
    }
  }

  // 2. 카테고리 비교 (태깅된 게시물만)
  const tagged = posts.filter((p) => p.category);
  const byCategory = summarizeGroups(groupBy(tagged, (p) => p.category));
  if (byCategory.length >= 2 && byCategory[0].avgEngagementRate > 0) {
    const best = byCategory[0];
    insights.push({
      icon: '🏷️',
      title: `'${best.key}' 콘텐츠 반응이 가장 좋아요`,
      description: `태깅된 콘텐츠 중 '${best.key}' 카테고리의 평균 참여율이 ${pct(best.avgEngagementRate)}로 가장 높습니다 (게시물 ${best.count}개 기준).`
    });
    const reachHeavy = [...tagged].sort((a, b) => (b.reach || 0) - (a.reach || 0))[0];
    const worst = byCategory[byCategory.length - 1];
    if (worst.key !== best.key && worst.avgEngagementRate < best.avgEngagementRate * 0.6) {
      insights.push({
        icon: '📣',
        title: `'${worst.key}' 콘텐츠는 도달 대비 참여가 아쉬워요`,
        description: `'${worst.key}' 카테고리는 참여율이 낮은 편(${pct(worst.avgEngagementRate)})입니다. 캡션에 질문이나 CTA(예: "댓글로 궁금한 점 남겨주세요")를 추가해보는 걸 추천해요.`
      });
    }
  } else if (tagged.length < posts.length) {
    const untaggedCount = posts.length - tagged.length;
    insights.push({
      icon: '🔖',
      title: '카테고리 태깅을 완료하면 더 정확한 인사이트를 받아요',
      description: `아직 카테고리가 지정되지 않은 게시물이 ${untaggedCount}개 있습니다. 아래 게시물 목록에서 태그를 지정해보세요.`
    });
  }

  // 3. 요일별 성과
  const byDay = summarizeGroups(groupBy(posts, (p) => DAY_NAMES[new Date(p.timestamp).getDay()]));
  if (byDay.length >= 2 && byDay[0].avgEngagementRate > 0) {
    insights.push({
      icon: '📅',
      title: `${byDay[0].key}요일 게시물의 반응이 좋아요`,
      description: `최근 게시물 기준 ${byDay[0].key}요일에 올린 콘텐츠의 평균 참여율(${pct(byDay[0].avgEngagementRate)})이 가장 높았습니다. 중요한 공고나 인터뷰 콘텐츠는 ${byDay[0].key}요일 업로드를 고려해보세요.`
    });
  }

  // 4. 팔로워 성장 추이 (팔로워 수가 실제로 기록된 스냅샷만 사용 — 도달만 백필된 날은 제외)
  const historyWithFollowers = history.filter((h) => h.follower_count != null);
  if (historyWithFollowers.length >= 2) {
    const latest = historyWithFollowers[historyWithFollowers.length - 1];
    const prev = historyWithFollowers[historyWithFollowers.length - 2];
    const delta = latest.follower_count - prev.follower_count;
    const midpoint = historyWithFollowers[Math.max(0, historyWithFollowers.length - 5)];
    const earlierDelta = midpoint ? prev.follower_count - midpoint.follower_count : null;
    let trendNote = '';
    if (earlierDelta != null && earlierDelta !== 0) {
      const change = delta - earlierDelta;
      trendNote = change > 0 ? ' 최근 성장세가 이전보다 가팔라지고 있어요.' : change < 0 ? ' 이전 구간 대비 성장세가 다소 둔화됐어요.' : '';
    }
    insights.push({
      icon: delta >= 0 ? '📈' : '📉',
      title: `최근 팔로워 ${delta >= 0 ? '+' : ''}${delta}명 변화`,
      description: `현재 팔로워 ${latest.follower_count.toLocaleString()}명, 직전 집계(${prev.date}) 대비 ${delta >= 0 ? '증가' : '감소'}했습니다.${trendNote}`
    });
  }

  // 5. 팔로우 전환율 (신규 팔로워 / 도달) — 도달만 늘리는 것보다 실제 팔로우로 이어지는지가 핵심
  const funnel = computeFunnel(history, posts);
  if (funnel && funnel.followConversionRate != null) {
    insights.push({
      icon: '🎯',
      title: `팔로우 전환율 ${pct(funnel.followConversionRate)}`,
      description: `최근 구간(${funnel.periodLabel}) 도달 계정 대비 신규 팔로워 비율입니다. 도달수만 늘리기보다 이 수치가 함께 오르는지 확인하면 콘텐츠가 실제 지원 관심층에 닿고 있는지 알 수 있어요.`
    });
  }

  // 6. 반기 목표 대비 달성률
  const goal = computeGoalProgress(settings, history);
  if (goal) {
    insights.push({
      icon: goal.achievementPct >= 100 ? '🏆' : '📊',
      title: `${goal.goalLabel || '목표'} 팔로워 순증 달성률 ${Math.round(goal.achievementPct)}%`,
      description: `목표 순증 ${goal.goalTargetNet.toLocaleString()}명 중 현재 ${goal.netSoFar.toLocaleString()}명 달성했습니다.`
    });
  }

  return insights;
}

module.exports = { generateInsights, engagementRate, MEDIA_TYPE_LABEL };
