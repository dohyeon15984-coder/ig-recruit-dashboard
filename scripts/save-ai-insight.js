// Claude가 쓴 AI 인사이트 리포트(JSON 파일)를 검증해서 대시보드에 저장하고, 공유용 사이트로도 전송한다.
// 사용법: node scripts/save-ai-insight.js <리포트.json>
//   리포트 JSON 형식: { headline, strengths[], concerns[], nextActions[], dataNotes[] } (lib/aiInsight.js 지침 참고)
require('dotenv').config();
const fs = require('fs');
const store = require('../lib/store');
const { pushToRemote } = require('../lib/pushToRemote');

function fail(msg) {
  console.error('저장 실패:', msg);
  process.exit(1);
}

(async () => {
  const file = process.argv[2];
  if (!file) fail('사용법: node scripts/save-ai-insight.js <리포트.json>');
  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    fail('JSON을 읽지 못했어요: ' + e.message);
  }

  if (typeof report.headline !== 'string' || !report.headline.trim()) fail('headline이 없어요.');
  const arr = (k, min) => {
    if (!Array.isArray(report[k]) || report[k].length < min) fail(`${k}가 비었거나 너무 적어요.`);
  };
  arr('strengths', 1); arr('concerns', 1); arr('nextActions', 3); arr('dataNotes', 1);
  for (const a of report.nextActions) {
    for (const f of ['priority', 'title', 'why', 'how', 'confidence']) if (a[f] == null || a[f] === '') fail(`nextActions 항목에 ${f}가 없어요.`);
  }
  for (const k of ['strengths', 'concerns']) for (const i of report[k]) if (!i.title || !i.detail) fail(`${k} 항목에 title/detail이 없어요.`);

  const posts = store.loadPosts().length + store.loadManualPosts().length;
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  store.saveAiInsight({
    generatedAt: new Date().toISOString(),
    model: 'Claude(자동 분석)',
    postCount: posts,
    usage: null,
    note: `이 리포트는 ${today} 기준 대시보드 데이터를 Claude가 직접 분석해 저장한 것이에요. 매일 아침 자동으로 갱신돼요.`,
    report
  });
  console.log('저장 완료:', report.headline.slice(0, 40));

  if (process.env.REMOTE_DASHBOARD_URL && process.env.ADMIN_SYNC_SECRET) {
    try {
      await pushToRemote(process.env.REMOTE_DASHBOARD_URL, process.env.ADMIN_SYNC_SECRET);
      console.log('공유용 사이트로 전송 완료');
    } catch (e) {
      console.error('공유용 사이트 전송 실패(로컬 저장은 됨):', e.message);
    }
  }
})();
