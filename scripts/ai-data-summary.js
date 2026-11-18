// 매일 아침 Claude(예약 작업)가 AI 인사이트를 분석할 때 읽는 입력: 분석 지침 + 현재 데이터 요약 + 직전 리포트.
// 사용법: node scripts/ai-data-summary.js
require('dotenv').config();
const store = require('../lib/store');
const { buildSummary, SYSTEM_PROMPT } = require('../lib/aiInsight');

const posts = store.applyPostCollabInfo(store.applyPostOverrides([...store.loadPosts(), ...store.loadManualPosts()]));
const summary = buildSummary({
  posts,
  history: store.loadHistory(),
  adCampaigns: store.loadAdCampaigns(),
  categories: store.loadCategories()
});
const previous = store.loadAiInsight();

console.log('===== 분석 지침 =====');
console.log(SYSTEM_PROMPT);
console.log('\n===== 직전 리포트(생성: ' + (previous ? previous.generatedAt : '없음') + ') =====');
console.log(previous ? JSON.stringify(previous.report) : '없음');
console.log('\n===== 현재 데이터(JSON) =====');
console.log(JSON.stringify(summary));
