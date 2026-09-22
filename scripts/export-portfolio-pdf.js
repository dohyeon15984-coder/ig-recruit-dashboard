// 포트폴리오용 PDF 내보내기: 대시보드의 4개 탭(①요약 ②프로필 데이터 ③광고 성과 분석
// ④전체 게시물)을 각각 스크롤/가로 스크롤 없이 통째로 캡처해서, 탭 하나 = 페이지 한 장인
// PDF로 합친다.
//
// 왜 인쇄(@page) 대신 스크린샷을 쓰나: 크로미움의 인쇄 파이프라인(`--print-to-pdf` CLI든
// CDP의 `Page.printToPDF`든)은 CSS `@page` 크기를 실제 콘텐츠 높이와 다르게 취급해서, 분명히
// 화면에서는 한 화면에 다 들어가는 내용이 인쇄에서는 여러 페이지로 쪼개지는 걸 여러 번
// 확인했다. 대신 `Page.captureScreenshot`(뷰포트 밖까지 전부 찍는 옵션 포함)으로 실제 렌더링
// 결과를 픽셀 그대로 캡처하면 화면에서 본 것과 100% 같은 결과를 보장할 수 있어서, 이 방식을 쓴다.
//
// 사용법 (로컬 대시보드가 켜져 있어야 함 — start-dashboard.bat):
//   node scripts/export-portfolio-pdf.js [저장할 파일 경로]

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BASE_URL = process.env.PORTFOLIO_BASE_URL || 'http://localhost:3000';
const CDP_PORT = 9333;
const PAGE_WIDTH = 1700;
const PAGES = [
  { key: 'summary', title: '① 요약' },
  { key: 'details', title: '② 프로필 데이터' },
  { key: 'ads', title: '③ 광고 성과 분석' },
  { key: 'posts', title: '④ 전체 게시물' }
];

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

function findBrowser() {
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome나 Edge를 찾지 못했어요. CHROME_PATH 환경변수로 실행 파일 경로를 알려주세요.');
  return found;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCdp(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      // 아직 안 떴으면 계속 재시도
    }
    await sleep(200);
  }
  throw new Error('헤드리스 브라우저의 디버깅 포트가 열리지 않았어요.');
}

// 새 탭을 만들고 그 탭의 WebSocket 디버거 URL을 받아온다.
async function openTab(port, url) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`탭을 열지 못했어요 (HTTP ${res.status})`);
  return res.json();
}

async function closeTab(port, targetId) {
  await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => {});
}

// CDP WebSocket에 명령 하나를 보내고 응답을 기다리는 아주 작은 헬퍼.
// (이 스크립트는 탭 하나에 명령 하나씩만 순서대로 보내는 단순한 용도라 범용 클라이언트는 안 만든다.)
function cdpSend(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// 탭 하나를 열어 놓고, 화면 전체(스크롤 영역 포함)를 PNG로 캡처해서 {width, height, buffer}로 돌려준다.
async function capturePageAsPng(port, wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let nextId = 1;
  await cdpSend(ws, nextId++, 'Page.enable');
  await cdpSend(ws, nextId++, 'Runtime.enable');

  // 브라우저의 load 이벤트는 웹폰트(Pretendard) 다운로드가 끝나는 걸 기다려주지 않아서, 그 전에
  // 캡처하면 나중에 폰트가 바뀌며 줄바꿈이 달라질 수 있다. load 대신 app.js가 (폰트까지 다
  // 확정된 뒤) 직접 남기는 표식을 기다린다.
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const { result } = await cdpSend(ws, nextId++, 'Runtime.evaluate', {
      expression: "document.documentElement.getAttribute('data-print-ready') === '1'"
    });
    if (result?.value) break;
    await sleep(150);
  }

  const metrics = await cdpSend(ws, nextId++, 'Page.getLayoutMetrics');
  const size = metrics.cssContentSize || metrics.contentSize;
  const height = Math.ceil(size.height);

  const shot = await cdpSend(ws, nextId++, 'Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: PAGE_WIDTH, height, scale: 1 }
  });

  ws.close();
  return { width: PAGE_WIDTH, height, buffer: Buffer.from(shot.data, 'base64') };
}

async function main() {
  const outFile = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'exports', 'portfolio.pdf');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  // 로컬 서버가 떠 있는지 먼저 확인 (없으면 start-dashboard.bat부터 켜라고 안내).
  try {
    await fetch(BASE_URL);
  } catch {
    console.error(`로컬 대시보드(${BASE_URL})에 연결할 수 없어요. start-dashboard.bat으로 먼저 켜주세요.`);
    process.exit(1);
  }

  const browserPath = findBrowser();
  console.log(`헤드리스 브라우저 실행: ${browserPath}`);
  const chrome = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      `--remote-debugging-port=${CDP_PORT}`,
      `--window-size=${PAGE_WIDTH},1100`,
      '--no-first-run',
      '--no-default-browser-check'
    ],
    { stdio: 'ignore' }
  );

  const shots = [];

  try {
    await waitForCdp(CDP_PORT);

    for (const page of PAGES) {
      const url = `${BASE_URL}/?print=${page.key}`;
      console.log(`캡처 중: ${page.title} (${url})`);
      const tab = await openTab(CDP_PORT, url);
      const shot = await capturePageAsPng(CDP_PORT, tab.webSocketDebuggerUrl);
      console.log(`  -> ${shot.width}x${shot.height}px`);
      await closeTab(CDP_PORT, tab.id);
      shots.push(shot);
    }
  } finally {
    chrome.kill();
  }

  console.log('4장을 하나의 PDF로 합치는 중...');
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.create();
  for (const shot of shots) {
    const image = await doc.embedPng(shot.buffer);
    const pdfPage = doc.addPage([shot.width, shot.height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: shot.width, height: shot.height });
  }
  fs.writeFileSync(outFile, await doc.save());
  console.log(`완료! ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
