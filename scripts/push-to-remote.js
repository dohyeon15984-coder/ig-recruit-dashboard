// Meta가 Render 같은 공용 클라우드 호스팅 IP를 차단해 배포 서버에서 직접 동기화가 안 될 때 쓰는 스크립트.
// 순서: 1) 로컬 PC에서 `npm start` 후 대시보드에서 "지금 동기화" 클릭 (여기는 차단 안 됨)
//       2) 아래 명령으로 방금 동기화한 데이터를 배포 서버로 전송
//
// 사용법: node scripts/push-to-remote.js <배포 URL>
//   예: node scripts/push-to-remote.js https://ig-recruit-dashboard.onrender.com

require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function main() {
  const remoteUrl = process.argv[2];
  if (!remoteUrl) {
    console.error('사용법: node scripts/push-to-remote.js <배포 URL>');
    process.exit(1);
  }

  const secret = process.env.ADMIN_SYNC_SECRET;
  if (!secret) {
    console.error('.env 에 ADMIN_SYNC_SECRET 을 먼저 채워넣어주세요 (배포 서버 환경변수와 같은 값이어야 해요).');
    process.exit(1);
  }

  const dataDir = path.join(__dirname, '..', 'data');
  const readJson = (file, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'));
    } catch {
      return fallback;
    }
  };

  const payload = {
    posts: readJson('posts.json', []),
    history: readJson('history.json', []),
    demographics: readJson('demographics.json', null),
    chartNotes: readJson('chartNotes.json', [])
  };

  console.log(`${remoteUrl.replace(/\/$/, '')}/api/admin/import 로 전송 중...`);
  const res = await fetch(`${remoteUrl.replace(/\/$/, '')}/api/admin/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
    body: JSON.stringify(payload)
  });

  const json = await res.json();
  if (!res.ok) {
    console.error('전송 실패:', json.error || res.status);
    process.exit(1);
  }
  console.log(`전송 완료! 게시물 ${json.importedPosts}개, 이력 ${json.importedHistory}건 반영됐어요.`);
}

main();
