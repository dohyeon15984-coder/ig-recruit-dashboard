// 로컬 JSON 파일 기반 저장소. 실서버(라이브) 모드에서 동기화한 데이터와 사용자가 지정한
// 카테고리 태그를 보관한다. 규모가 작은 사내 도구라 별도 DB 없이 파일로 충분하다.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEMOGRAPHICS_FILE = path.join(DATA_DIR, 'demographics.json');
const CHART_NOTES_FILE = path.join(DATA_DIR, 'chartNotes.json');
const AD_CAMPAIGNS_FILE = path.join(DATA_DIR, 'adCampaigns.json');
const POST_OVERRIDES_FILE = path.join(DATA_DIR, 'postOverrides.json');
const OVERRIDABLE_POST_FIELDS = ['reach', 'views', 'like_count', 'comments_count', 'saved', 'shares'];

const DEFAULT_SETTINGS = { goalLabel: '', goalBaselineFollowers: null, goalTargetNet: null };

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function loadPosts() {
  return readJson(POSTS_FILE, []);
}

function loadHistory() {
  return readJson(HISTORY_FILE, []);
}

// 새로 받아온 게시물 목록을 기존에 저장된 카테고리 태그를 보존하면서 병합한다.
function mergePosts(freshPosts) {
  const existing = loadPosts();
  const existingById = new Map(existing.map((p) => [p.id, p]));
  const merged = freshPosts.map((p) => ({
    ...p,
    category: existingById.get(p.id)?.category ?? null
  }));
  writeJson(POSTS_FILE, merged);
  return merged;
}

// mergePosts와 반대 방향의 병합: 다른 인스턴스(예: 로컬 PC)에서 이미 태깅된 게시물 목록을
// 그대로 들여올 때 쓴다. 들어오는 카테고리가 있으면 그걸 우선하고, 없을 때만 기존 값을 유지한다.
function importPosts(incomingPosts) {
  const existing = loadPosts();
  const existingById = new Map(existing.map((p) => [p.id, p]));
  const merged = incomingPosts.map((p) => ({
    ...p,
    category: p.category ?? existingById.get(p.id)?.category ?? null
  }));
  writeJson(POSTS_FILE, merged);
  return merged;
}

function setPostCategory(postId, category) {
  const posts = loadPosts();
  const post = posts.find((p) => p.id === postId);
  if (!post) return null;
  post.category = category;
  writeJson(POSTS_FILE, posts);
  return post;
}

// 같은 날짜의 기존 스냅샷에 새 값을 필드 단위로 병합한다 (null/undefined는 기존 값을 덮어쓰지 않음).
// 예: 오늘자 팔로워 수(단건 조회)와 최근 30일 도달/방문 백필(팔로워 수는 null)이 서로 다른 시점에
// 들어와도 서로의 값을 지우지 않도록 하기 위함.
function mergeHistorySnapshots(snapshots) {
  const history = loadHistory();
  const byDate = new Map(history.map((h) => [h.date, h]));

  for (const snap of snapshots) {
    const existing = byDate.get(snap.date) || { date: snap.date };
    const merged = { ...existing };
    for (const key of Object.keys(snap)) {
      if (snap[key] != null) merged[key] = snap[key];
    }
    byDate.set(snap.date, merged);
  }

  const result = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  writeJson(HISTORY_FILE, result);
  return result;
}

function appendHistorySnapshot(snapshot) {
  return mergeHistorySnapshots([snapshot]);
}

// 반기별 목표(예: "2026 하반기 팔로워 순증 500명") 대비 달성률을 추적하기 위한 설정.
// 기존에 사용자가 엑셀로 관리하던 "2026 상반기 KPI / 달성도" 패턴을 그대로 옮긴 것.
function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
}

function saveSettings(partial) {
  const merged = { ...loadSettings(), ...partial };
  writeJson(SETTINGS_FILE, merged);
  return merged;
}

// 팔로워 성별/연령대 분포는 "현재 상태" 스냅샷이라 이력 없이 최신 1건만 보관한다.
function loadDemographics() {
  return readJson(DEMOGRAPHICS_FILE, null);
}

function saveDemographics(demographics) {
  writeJson(DEMOGRAPHICS_FILE, demographics);
  return demographics;
}

// 차트 위 특정 시점(예: "2026-06" 또는 "2026-06-15")에 남기는 메모.
// 왜 그 달/그날 수치가 튀었는지 등을 기록해두기 위한 용도 — chartKey+period 당 1건만 유지한다.
function loadChartNotes() {
  return readJson(CHART_NOTES_FILE, []);
}

function saveChartNote({ chartKey, period, text }) {
  const notes = loadChartNotes();
  const id = `${chartKey}:${period}`;
  const trimmed = (text || '').trim();
  const filtered = notes.filter((n) => n.id !== id);
  if (trimmed) {
    filtered.push({ id, chartKey, period, text: trimmed, updatedAt: new Date().toISOString() });
  }
  writeJson(CHART_NOTES_FILE, filtered);
  return filtered;
}

// 게시물 단위 유료 광고(부스트/프로모션) 집행 내역. Meta 광고 API 연동 없이,
// 사용자가 Ads Manager에서 직접 확인한 값(비용/기간)을 수동으로 기록해두는 용도.
function loadAdCampaigns() {
  return readJson(AD_CAMPAIGNS_FILE, []);
}

function saveAdCampaign(campaign) {
  const campaigns = loadAdCampaigns();
  const id = campaign.id || `ad_${Date.now()}_${Math.round(Math.random() * 1000)}`;
  const record = { ...campaign, id };
  const filtered = campaigns.filter((c) => c.id !== id);
  filtered.push(record);
  filtered.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  writeJson(AD_CAMPAIGNS_FILE, filtered);
  return record;
}

function deleteAdCampaign(id) {
  const campaigns = loadAdCampaigns().filter((c) => c.id !== id);
  writeJson(AD_CAMPAIGNS_FILE, campaigns);
  return campaigns;
}

// 게시물별 "실제 전체 수치(오가닉+유료 홍보 합산)" 수동 보정값. Graph API 기본 인사이트는
// 오가닉 몫만 주기 때문에, 광고를 태운 게시물은 인스타그램 앱에서 보이는 진짜 합산 값을
// 사용자가 직접 입력해두면 그 값이 대시보드 전체(요약/차트 포함)에 우선 반영되도록 한다.
function loadPostOverrides() {
  return readJson(POST_OVERRIDES_FILE, {});
}

function savePostOverride(postId, fields) {
  const overrides = loadPostOverrides();
  const clean = {};
  for (const key of OVERRIDABLE_POST_FIELDS) {
    if (fields[key] !== undefined && fields[key] !== null && fields[key] !== '') {
      const n = Number(fields[key]);
      if (!Number.isNaN(n)) clean[key] = n;
    }
  }
  if (Object.keys(clean).length) {
    overrides[postId] = clean;
  } else {
    delete overrides[postId];
  }
  writeJson(POST_OVERRIDES_FILE, overrides);
  return overrides;
}

function clearPostOverride(postId) {
  const overrides = loadPostOverrides();
  delete overrides[postId];
  writeJson(POST_OVERRIDES_FILE, overrides);
  return overrides;
}

// posts 목록에 보정값을 덮어씌운다 (보정값이 있는 게시물에는 has_override:true 표시).
function applyPostOverrides(posts) {
  const overrides = loadPostOverrides();
  if (!Object.keys(overrides).length) return posts;
  return posts.map((p) => {
    const ov = overrides[p.id];
    if (!ov) return p;
    return { ...p, ...ov, has_override: true };
  });
}

module.exports = {
  loadPosts,
  loadHistory,
  mergePosts,
  importPosts,
  setPostCategory,
  appendHistorySnapshot,
  mergeHistorySnapshots,
  loadSettings,
  saveSettings,
  loadDemographics,
  loadAdCampaigns,
  saveAdCampaign,
  deleteAdCampaign,
  saveDemographics,
  loadChartNotes,
  saveChartNote,
  loadPostOverrides,
  savePostOverride,
  clearPostOverride,
  applyPostOverrides
};
