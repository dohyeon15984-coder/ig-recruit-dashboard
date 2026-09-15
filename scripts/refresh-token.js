// 단기(short-lived) 액세스 토큰을 60일짜리 장기(long-lived) 토큰으로 교환하는 CLI 헬퍼.
//
// 사용법:
//   1. .env 에 FB_APP_ID, FB_APP_SECRET 을 채워넣는다 (Meta 개발자 앱 대시보드에서 확인).
//   2. Graph API Explorer에서 새로 발급받은 단기 토큰을 인자로 전달한다:
//        node scripts/refresh-token.js <단기_토큰>
//   3. 출력된 장기 토큰을 .env 의 IG_ACCESS_TOKEN 에 붙여넣고, IG_TOKEN_ISSUED_AT을 오늘 날짜로 갱신한다.

require('dotenv').config();

async function main() {
  const shortLivedToken = process.argv[2];
  if (!shortLivedToken) {
    console.error('사용법: node scripts/refresh-token.js <단기_토큰>');
    process.exit(1);
  }

  const { FB_APP_ID, FB_APP_SECRET } = process.env;
  if (!FB_APP_ID || !FB_APP_SECRET) {
    console.error('.env 에 FB_APP_ID, FB_APP_SECRET 을 먼저 채워넣어주세요.');
    process.exit(1);
  }

  const url =
    `https://graph.facebook.com/v22.0/oauth/access_token` +
    `?grant_type=fb_exchange_token&client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}` +
    `&fb_exchange_token=${shortLivedToken}`;

  const res = await fetch(url);
  const json = await res.json();

  if (json.error) {
    console.error('토큰 교환 실패:', json.error.message);
    process.exit(1);
  }

  console.log('\n장기 액세스 토큰 발급 완료 (약 60일 유효):\n');
  console.log(json.access_token);
  console.log('\n.env 파일에 아래처럼 반영하세요:');
  console.log(`IG_ACCESS_TOKEN=${json.access_token}`);
  console.log(`IG_TOKEN_ISSUED_AT=${new Date().toISOString().slice(0, 10)}`);
}

main();
