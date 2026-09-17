// Meta가 Render 같은 공용 클라우드 호스팅 IP를 차단해 배포 서버에서 직접 동기화가 안 될 때 쓰는 스크립트.
// 순서: 1) 로컬 PC에서 `npm start` 후 대시보드에서 "지금 동기화" 클릭 (여기는 차단 안 됨, 자동으로 배포 서버까지 전송됨)
//       2) 자동 전송이 안 됐거나 수동으로 다시 보내고 싶을 때만 아래 명령 사용
//
// 사용법: node scripts/push-to-remote.js [배포 URL]
//   예: node scripts/push-to-remote.js https://ig-recruit-dashboard.onrender.com
//   배포 URL을 생략하면 .env의 REMOTE_DASHBOARD_URL을 사용합니다.

require('dotenv').config();
const { pushToRemote } = require('../lib/pushToRemote');

async function main() {
  const remoteUrl = process.argv[2] || process.env.REMOTE_DASHBOARD_URL;
  if (!remoteUrl) {
    console.error('사용법: node scripts/push-to-remote.js <배포 URL>  (또는 .env에 REMOTE_DASHBOARD_URL을 설정하면 생략 가능)');
    process.exit(1);
  }

  const secret = process.env.ADMIN_SYNC_SECRET;
  if (!secret) {
    console.error('.env 에 ADMIN_SYNC_SECRET 을 먼저 채워넣어주세요 (배포 서버 환경변수와 같은 값이어야 해요).');
    process.exit(1);
  }

  console.log(`${remoteUrl.replace(/\/$/, '')}/api/admin/import 로 전송 중...`);
  try {
    const json = await pushToRemote(remoteUrl, secret);
    console.log(`전송 완료! 게시물 ${json.importedPosts}개, 이력 ${json.importedHistory}건 반영됐어요.`);
  } catch (err) {
    console.error('전송 실패:', err.message);
    process.exit(1);
  }
}

main();
