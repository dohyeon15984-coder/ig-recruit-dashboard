// 대시보드 조회 필터(기간/유형/카테고리/검색어)를 게시물·이력 배열에 적용한다.

function daysAgoDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function filterPosts(posts, query = {}) {
  const { days, mediaType, category, search } = query;
  let result = posts;

  if (days && days !== 'all') {
    const cutoff = daysAgoDate(Number(days));
    result = result.filter((p) => new Date(p.timestamp) >= cutoff);
  }

  if (mediaType && mediaType !== 'ALL') {
    result = result.filter((p) => p.media_type === mediaType);
  }

  if (category && category !== 'ALL') {
    result = category === 'UNTAGGED' ? result.filter((p) => !p.category) : result.filter((p) => p.category === category);
  }

  if (search) {
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((p) => (p.caption || '').toLowerCase().includes(q));
  }

  return result;
}

function filterHistory(history, query = {}) {
  const { days } = query;
  if (!days || days === 'all') return history;
  const cutoff = daysAgoDate(Number(days)).toISOString().slice(0, 10);
  return history.filter((h) => h.date >= cutoff);
}

module.exports = { filterPosts, filterHistory };
