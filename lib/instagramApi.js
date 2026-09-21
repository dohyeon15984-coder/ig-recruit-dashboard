// Instagram Graph API 래퍼. Meta는 지표 이름을 자주 변경하므로(예: impressions -> views),
// 개별 호출을 최대한 방어적으로 작성해 일부 지표가 실패해도 전체 동기화가 죽지 않게 한다.

const GRAPH_VERSION = 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function graphGetUrl(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    const err = new Error(json.error.message || 'Graph API error');
    err.graphError = json.error;
    throw err;
  }
  return json;
}

async function graphGet(pathAndQuery) {
  return graphGetUrl(`${GRAPH_BASE}/${pathAndQuery}`);
}

// 동시에 너무 많은 요청을 보내지 않도록 동시 실행 개수를 제한하며 매핑한다.
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function getAccountSnapshot(igUserId, accessToken) {
  const account = await graphGet(
    `${igUserId}?fields=username,name,followers_count,media_count,profile_picture_url&access_token=${accessToken}`
  );

  let insightsByMetric = {};
  try {
    const insights = await graphGet(
      `${igUserId}/insights?metric=reach,profile_views&period=day&metric_type=total_value&access_token=${accessToken}`
    );
    for (const item of insights.data || []) {
      insightsByMetric[item.name] = item.total_value?.value ?? null;
    }
  } catch (err) {
    console.warn('[instagramApi] 계정 인사이트 조회 실패 (지표명이 변경됐을 수 있음):', err.message);
  }

  return {
    account,
    todaySnapshot: {
      date: new Date().toISOString().slice(0, 10),
      follower_count: account.followers_count,
      reach: insightsByMetric.reach ?? null,
      profile_views: insightsByMetric.profile_views ?? null
    }
  };
}

async function getMediaInsights(mediaId, accessToken) {
  const attempts = [
    ['reach', 'saved', 'views', 'shares', 'reposts'],
    ['reach', 'saved', 'views', 'shares'],
    ['reach', 'saved', 'views'],
    ['reach', 'saved'],
    ['reach']
  ];
  for (const metrics of attempts) {
    try {
      const res = await graphGet(`${mediaId}/insights?metric=${metrics.join(',')}&access_token=${accessToken}`);
      const byMetric = {};
      for (const item of res.data || []) {
        byMetric[item.name] = item.values?.[0]?.value ?? null;
      }
      return byMetric;
    } catch {
      // 다음 지표 조합으로 재시도
    }
  }
  return {};
}

// 프로필 방문/팔로우는 피드 게시물(카드뉴스·이미지)에서만 제공되고 릴스는 API가 지원하지 않는다
// (지원 안 하면 null로 남겨서 화면에 "-"로 표시하고, 필요하면 사용자가 직접 입력한다).
async function getMediaFollowInsights(mediaId, accessToken) {
  try {
    const res = await graphGet(`${mediaId}/insights?metric=follows,profile_visits&access_token=${accessToken}`);
    const byMetric = {};
    for (const item of res.data || []) byMetric[item.name] = item.values?.[0]?.value ?? null;
    return byMetric;
  } catch {
    return {};
  }
}

const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,username';

// 페이지네이션을 끝까지 따라가며 주어진 edge(media 또는 tags)의 게시물을 모두 가져온다
// (안전장치로 최대 50페이지 = 최대 5,000개).
async function getAllRawMediaFromEdge(igUserId, accessToken, edge) {
  let url = `${GRAPH_BASE}/${igUserId}/${edge}?fields=${MEDIA_FIELDS}&limit=100&access_token=${accessToken}`;
  const rawPosts = [];
  let pageCount = 0;
  const MAX_PAGES = 50;

  while (url && pageCount < MAX_PAGES) {
    const page = await graphGetUrl(url);
    rawPosts.push(...(page.data || []));
    url = page.paging && page.paging.next ? page.paging.next : null;
    pageCount++;
  }
  return rawPosts;
}

// 계정이 직접 올린 게시물은 /media, 공동 작성(콜라보)으로 태그된 게시물은 /tags 로 따로 내려온다
// — 콜라보 게시물의 "원작성자"가 따로 있으면 Graph API가 /media 에는 포함해주지 않기 때문.
// 두 목록을 합쳐서 피드에 보이는 게시물을 전부 가져오고, id로 중복을 제거한다.
async function getAllRawMedia(igUserId, accessToken) {
  const [ownMedia, taggedMedia] = await Promise.all([
    getAllRawMediaFromEdge(igUserId, accessToken, 'media'),
    getAllRawMediaFromEdge(igUserId, accessToken, 'tags').catch((err) => {
      console.warn('[instagramApi] 태그된(공동 게시물 포함) 게시물 조회 실패:', err.message);
      return [];
    })
  ]);

  const byId = new Map();
  for (const raw of ownMedia) byId.set(raw.id, { ...raw, is_collab: false });
  for (const raw of taggedMedia) {
    if (!byId.has(raw.id)) byId.set(raw.id, { ...raw, is_collab: true });
  }
  return [...byId.values()];
}

async function getRecentMedia(igUserId, accessToken) {
  const rawPosts = await getAllRawMedia(igUserId, accessToken);

  return mapWithConcurrency(rawPosts, 8, async (raw) => {
    const insights = await getMediaInsights(raw.id, accessToken);
    const followInsights = raw.media_product_type === 'REELS' ? {} : await getMediaFollowInsights(raw.id, accessToken);
    return {
      id: raw.id,
      caption: raw.caption || '',
      // 장표 1장짜리 IMAGE 게시물도 실질적으로 카드뉴스와 같은 콘텐츠라 별도 유형으로 두지 않고
      // 카드뉴스(CAROUSEL_ALBUM)로 합친다.
      media_type: raw.media_type === 'IMAGE' ? 'CAROUSEL_ALBUM' : raw.media_type,
      is_reel: raw.media_product_type === 'REELS',
      is_collab: raw.is_collab ?? false,
      author_username: raw.username || null,
      permalink: raw.permalink,
      thumbnail_url: raw.thumbnail_url || raw.media_url || null,
      timestamp: raw.timestamp,
      like_count: raw.like_count ?? 0,
      comments_count: raw.comments_count ?? 0,
      saved: insights.saved ?? 0,
      shares: insights.shares ?? 0,
      reposts: insights.reposts ?? 0,
      reach: insights.reach ?? 0,
      views: insights.views ?? 0,
      profile_visits: followInsights.profile_visits ?? null,
      follows: followInsights.follows ?? null
    };
  });
}

// 최근 N일간의 일별 도달 시계열을 한 번에 가져와 history를 소급 백필한다.
// (팔로워 수와 profile_views는 Meta가 time_series 백필을 지원하지 않아 여기 포함할 수 없다
// — 매 동기화마다 오늘자 값만 getAccountSnapshot을 통해 누적된다.)
async function getDailyInsightsHistory(igUserId, accessToken, days = 30) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 24 * 60 * 60;

  try {
    const insights = await graphGet(
      `${igUserId}/insights?metric=reach&period=day&metric_type=time_series&since=${since}&until=${until}&access_token=${accessToken}`
    );

    const byDate = new Map();
    for (const item of insights.data || []) {
      for (const v of item.values || []) {
        const date = v.end_time.slice(0, 10);
        if (!byDate.has(date)) byDate.set(date, { date, follower_count: null, reach: null, profile_views: null });
        byDate.get(date)[item.name] = v.value ?? null;
      }
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    console.warn('[instagramApi] 일별 인사이트 백필 실패 (지표명이 변경됐을 수 있음):', err.message);
    return [];
  }
}

// 팔로워 성별/연령대 분포 ("지금 이 순간" 기준 스냅샷 — Meta는 이 지표의 과거 이력을 제공하지 않는다).
// 100명 미만 팔로워 계정에는 Meta가 이 지표를 아예 반환하지 않는다.
async function getFollowerDemographics(igUserId, accessToken) {
  async function fetchBreakdown(breakdown) {
    try {
      const res = await graphGet(
        `${igUserId}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${breakdown}&timeframe=last_90_days&access_token=${accessToken}`
      );
      const results = res.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
      const map = {};
      for (const r of results) {
        const key = r.dimension_values[r.dimension_values.length - 1];
        map[key] = (map[key] || 0) + (r.value || 0);
      }
      return map;
    } catch (err) {
      console.warn(`[instagramApi] follower_demographics(${breakdown}) 조회 실패:`, err.message);
      return null;
    }
  }

  const [gender, age] = await Promise.all([fetchBreakdown('gender'), fetchBreakdown('age')]);
  return { gender, age, fetchedAt: new Date().toISOString() };
}

module.exports = { getAccountSnapshot, getRecentMedia, getDailyInsightsHistory, getFollowerDemographics };
