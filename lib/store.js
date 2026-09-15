// 로컬 JSON 파일 기반 저장소. 실서버(라이브) 모드에서 동기화한 데이터와 사용자가 지정한
// 카테고리 태그를 보관한다. 규모가 작은 사내 도구라 별도 DB 없이 파일로 충분하다.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEMOGRAPHICS_FILE = path.join(DATA_DIR, 'demographics.json');

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

module.exports = {
  loadPosts,
  loadHistory,
  mergePosts,
  setPostCategory,
  appendHistorySnapshot,
  mergeHistorySnapshots,
  loadSettings,
  saveSettings,
  loadDemographics,
  saveDemographics
};
