// 데모 모드용 샘플 데이터. 실제 토큰 발급 전에도 대시보드 UI/인사이트 로직을 확인할 수 있도록 제공한다.

function daysAgo(n, hour = 11) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

const DEMO_POSTS = [
  { id: 'demo_1', caption: '2027 상반기 신입 공채 시작! 지금 바로 지원하세요 📢', media_type: 'IMAGE', category: '채용공고', daysAgo: 55, like_count: 210, comments_count: 8, saved: 34, shares: 6, reach: 8200, views: 8200 },
  { id: 'demo_2', caption: '편집국 선배가 말하는 기자의 하루 (feat. 신입 vs 5년차)', media_type: 'VIDEO', category: '현직자 인터뷰', daysAgo: 52, like_count: 890, comments_count: 61, saved: 210, shares: 58, reach: 15400, views: 21300 },
  { id: 'demo_3', caption: '동아일보 사옥 투어 🏢 이런 곳에서 일해요', media_type: 'CAROUSEL_ALBUM', category: '조직문화', daysAgo: 49, like_count: 430, comments_count: 22, saved: 88, shares: 14, reach: 9800, views: 9800 },
  { id: 'demo_4', caption: '복지제도 총정리: 육아휴직부터 자기계발비까지', media_type: 'CAROUSEL_ALBUM', category: '제도소개', daysAgo: 46, like_count: 610, comments_count: 34, saved: 340, shares: 41, reach: 11200, views: 11200 },
  { id: 'demo_5', caption: '채용설명회 현장 스케치 (feat. 인사팀)', media_type: 'IMAGE', category: '교육', daysAgo: 43, like_count: 150, comments_count: 5, saved: 12, shares: 3, reach: 5100, views: 5100 },
  { id: 'demo_6', caption: '수습기자는 이렇게 일합니다 (브이로그)', media_type: 'VIDEO', category: '현직자 인터뷰', daysAgo: 40, like_count: 1120, comments_count: 88, saved: 305, shares: 76, reach: 19800, views: 27600 },
  { id: 'demo_7', caption: '채용 공고 마감 D-3 놓치지 마세요', media_type: 'IMAGE', category: '채용공고', daysAgo: 37, like_count: 180, comments_count: 4, saved: 20, shares: 9, reach: 7600, views: 7600 },
  { id: 'demo_8', caption: '점심시간 브이로그: 사내식당 가보기', media_type: 'VIDEO', category: '조직문화', daysAgo: 34, like_count: 760, comments_count: 45, saved: 130, shares: 33, reach: 14100, views: 18900 },
  { id: 'demo_9', caption: '자소서 첨삭 꿀팁 카드뉴스', media_type: 'CAROUSEL_ALBUM', category: '취준꿀팁', daysAgo: 31, like_count: 520, comments_count: 29, saved: 410, shares: 62, reach: 10600, views: 10600 },
  { id: 'demo_10', caption: '디지털뉴스팀은 무슨 일을 할까? 인터뷰', media_type: 'VIDEO', category: '현직자 인터뷰', daysAgo: 28, like_count: 980, comments_count: 72, saved: 260, shares: 64, reach: 17200, views: 23100, is_collab: true, author_username: 'donga_digital' },
  { id: 'demo_11', caption: '여름 워크숍 브이로그', media_type: 'VIDEO', category: '교육', daysAgo: 25, like_count: 690, comments_count: 38, saved: 95, shares: 21, reach: 12800, views: 16700 },
  { id: 'demo_12', caption: '2027 하반기 공채 예고', media_type: 'IMAGE', category: '채용공고', daysAgo: 22, like_count: 240, comments_count: 11, saved: 41, shares: 12, reach: 8900, views: 8900 },
  { id: 'demo_13', caption: '재직자가 뽑은 동아일보 복지 TOP 5', media_type: 'CAROUSEL_ALBUM', category: '제도소개', daysAgo: 19, like_count: 700, comments_count: 40, saved: 380, shares: 47, reach: 12300, views: 12300 },
  { id: 'demo_14', caption: '면접관 마음을 사로잡는 답변법 (feat. 인사팀장)', media_type: 'VIDEO', category: '현직자 인터뷰', daysAgo: 14, like_count: 1340, comments_count: 105, saved: 420, shares: 91, reach: 22100, views: 31200 },
  { id: 'demo_15', caption: '사내 동아리 소개: 러닝크루 편', media_type: 'IMAGE', category: '조직문화', daysAgo: 9, like_count: 260, comments_count: 14, saved: 30, shares: 7, reach: 6400, views: 6400 },
  { id: 'demo_16', caption: '입사 1년차가 말하는 리얼 후기', media_type: 'VIDEO', category: null, daysAgo: 4, like_count: 505, comments_count: 33, saved: 140, shares: 29, reach: 10100, views: 13400 }
].map((p) => ({
  ...p,
  is_reel: p.media_type === 'VIDEO',
  reposts: Math.round((p.shares || 0) * 0.3),
  permalink: '#',
  thumbnail_url: null,
  timestamp: daysAgo(p.daysAgo)
}));

// 8주간 주간 스냅샷 (팔로워/도달/조회 추이)
const DEMO_HISTORY = [
  { date: weeksAgoDate(8), follower_count: 12480, reach: 41000, views: 52000, profile_views: 1800 },
  { date: weeksAgoDate(7), follower_count: 12610, reach: 43500, views: 55800, profile_views: 1900 },
  { date: weeksAgoDate(6), follower_count: 12735, reach: 40200, views: 51200, profile_views: 1750 },
  { date: weeksAgoDate(5), follower_count: 12900, reach: 46800, views: 61300, profile_views: 2100 },
  { date: weeksAgoDate(4), follower_count: 13120, reach: 48100, views: 64700, profile_views: 2260 },
  { date: weeksAgoDate(3), follower_count: 13340, reach: 45600, views: 59800, profile_views: 2080 },
  { date: weeksAgoDate(2), follower_count: 13610, reach: 51200, views: 70200, profile_views: 2430 },
  { date: weeksAgoDate(1), follower_count: 13890, reach: 53800, views: 74100, profile_views: 2590 },
  { date: weeksAgoDate(0), follower_count: 14150, reach: 55200, views: 77300, profile_views: 2710 }
];

function weeksAgoDate(n) {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return d.toISOString().slice(0, 10);
}

const DEMO_ACCOUNT = {
  username: 'donga_recruit (demo)',
  name: '동아일보 채용',
  followers_count: DEMO_HISTORY[DEMO_HISTORY.length - 1].follower_count,
  media_count: DEMO_POSTS.length,
  profile_picture_url: null
};

// 사용자가 기존에 엑셀로 관리하던 "반기 목표 팔로워 순증 / 달성도" 패턴을 데모로 재현
const DEMO_SETTINGS = {
  goalLabel: '2026 하반기',
  goalBaselineFollowers: DEMO_HISTORY[0].follower_count,
  goalTargetNet: 1500
};

// 팔로워 성별/연령대 분포 데모 (실제로는 Meta의 follower_demographics 인사이트로 대체됨)
const DEMO_DEMOGRAPHICS = {
  gender: { F: 8200, M: 5670, U: 280 },
  age: { '13-17': 280, '18-24': 6200, '25-34': 5670, '35-44': 1420, '45-54': 420, '55-64': 120, '65+': 40 },
  fetchedAt: new Date().toISOString()
};

module.exports = { DEMO_POSTS, DEMO_HISTORY, DEMO_ACCOUNT, DEMO_SETTINGS, DEMO_DEMOGRAPHICS };
