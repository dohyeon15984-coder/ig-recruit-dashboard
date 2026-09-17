// 로컬 데이터를 배포 서버(Render)로 밀어넣는 공통 로직. scripts/push-to-remote.js(수동 실행)와
// routes/api.js의 /api/sync 핸들러(동기화 버튼 클릭 시 자동 실행) 양쪽에서 재사용한다.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
  } catch {
    return fallback;
  }
}

function buildImportPayload() {
  return {
    posts: readJson('posts.json', []),
    history: readJson('history.json', []),
    demographics: readJson('demographics.json', null),
    chartNotes: readJson('chartNotes.json', []),
    adCampaigns: readJson('adCampaigns.json', []),
    postOverrides: readJson('postOverrides.json', {}),
    categories: readJson('categories.json', null),
    postCollabInfo: readJson('postCollabInfo.json', {}),
    manualPosts: readJson('manualPosts.json', [])
  };
}

async function pushToRemote(remoteUrl, secret) {
  if (!remoteUrl) throw new Error('배포 서버 URL이 설정되지 않았어요 (.env의 REMOTE_DASHBOARD_URL).');
  if (!secret) throw new Error('.env에 ADMIN_SYNC_SECRET이 설정되지 않았어요.');

  const payload = buildImportPayload();
  const res = await fetch(`${remoteUrl.replace(/\/$/, '')}/api/admin/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || `배포 서버 응답 실패 (${res.status})`);
  }
  return json;
}

module.exports = { pushToRemote, buildImportPayload };
