// 단기(short-lived) 액세스 토큰을 60일짜리 장기(long-lived) 토큰으로 교환하는 CLI 헬퍼.
//
// 사용법:
//   1. .env 에 FB_APP_ID, FB_APP_SECRET 이 들어있어야 한다 (Meta 개발자 앱 대시보드에서 확인).
//   2. Graph API Explorer에서 새로 발급받은 단기 토큰을 인자로 전달한다:
//        node scripts/refresh-token.js <단기_토큰>            → 결과만 출력 (.env는 직접 수정)
//        node scripts/refresh-token.js --save <단기_토큰>     → 검증 후 .env 를 자동으로 갱신
//      (refresh-token.bat 이 --save 로 실행한다)

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ENV_FILE = process.env.ENV_FILE || path.join(__dirname, '..', '.env');

function upsertEnvLine(content, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, `${key}=${value}`);
  const sep = content.endsWith('\n') ? '' : '\n';
  return `${content}${sep}${key}=${value}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const save = args.includes('--save');
  const shortLivedToken = args.find((a) => a !== '--save');
  if (!shortLivedToken) {
    console.error('사용법: node scripts/refresh-token.js [--save] <단기_토큰>');
    process.exit(1);
  }

  const { FB_APP_ID, FB_APP_SECRET, IG_BUSINESS_ACCOUNT_ID } = process.env;
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

  const newToken = json.access_token;
  const today = new Date().toISOString().slice(0, 10);

  if (!save) {
    console.log('\n장기 액세스 토큰 발급 완료 (약 60일 유효):\n');
    console.log(newToken);
    console.log('\n.env 파일에 아래처럼 반영하세요:');
    console.log(`IG_ACCESS_TOKEN=${newToken}`);
    console.log(`IG_TOKEN_ISSUED_AT=${today}`);
    return;
  }

  // 새 토큰으로 실제 인스타그램 계정을 조회해보고, 성공했을 때만 .env를 덮어쓴다.
  const check = await fetch(
    `https://graph.facebook.com/v22.0/${IG_BUSINESS_ACCOUNT_ID}?fields=username&access_token=${newToken}`
  ).then((r) => r.json());
  if (check.error) {
    console.error('새 토큰으로 인스타그램 계정 조회에 실패했어요. .env는 바꾸지 않았어요:', check.error.message);
    process.exit(1);
  }

  fs.copyFileSync(ENV_FILE, `${ENV_FILE}.bak`);
  let content = fs.readFileSync(ENV_FILE, 'utf-8');
  content = upsertEnvLine(content, 'IG_ACCESS_TOKEN', newToken);
  content = upsertEnvLine(content, 'IG_TOKEN_ISSUED_AT', today);
  fs.writeFileSync(ENV_FILE, content, 'utf-8');

  console.log(`\n성공! @${check.username} 계정으로 확인했고, .env 를 새 토큰(발급일 ${today})으로 갱신했어요.`);
  console.log('이전 .env 는 .env.bak 으로 백업해뒀어요. 서버를 껐다가 다시 켜면 적용돼요.');
}

main();
