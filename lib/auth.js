// 공유용 사이트(Render) 접근 제한: "열람 신청 → 관리자 승인" 방식.
// AUTH_REQUIRED=true 인 서버에서만 켜진다(로컬 PC 대시보드는 인증 없이 그대로).
//
// 흐름
//  1) 처음 온 사람은 로그인 화면에서 이름·부서·회사 메일(@donga.com, @ichannela.com)·PIN(숫자 6자리)으로 열람 신청.
//     → 공유 사이트의 accessRequests.json 에 쌓인다(메일은 보내지 않는다. 회사 메일 서버가 외부 발송 메일을 막아서).
//  2) 관리자가 로컬 대시보드 "열람자 관리"에서 승인 → 로컬 viewers.json(원본)에 추가되고 공유 사이트로 전송된다.
//  3) 승인된 사람은 회사 메일 + PIN 으로 로그인한다. 로그인은 서명된 쿠키로 30일 유지된다.
//  4) 회수하면 승인 목록에서 빠지고, 매 요청마다 목록을 확인하므로 바로 막힌다.
//
// PIN은 scrypt로 해시해서만 보관한다. 로그인 실패는 메일·IP별로 횟수를 제한한다.

const crypto = require('crypto');
const express = require('express');
const path = require('path');
const store = require('./store');

const SESSION_DAYS = 30;
const COOKIE_NAME = 'ig_dash_session';
const MAX_FAILS_PER_EMAIL = 5;
const MAX_FAILS_PER_IP = 20;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_IP_HOUR = 5;

const failsByEmail = new Map();
const failsByIp = new Map();
const requestsByIp = new Map();

function allowedDomains() {
  return (process.env.ALLOWED_EMAIL_DOMAINS || 'donga.com,ichannela.com')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

// 형식이 맞고, @ 뒤가 허용 도메인과 "정확히" 같은 주소만 통과(donga.com.evil.com, x@sub.donga.com 등은 거절).
function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  const m = email.match(/^[a-z0-9._%+-]{1,64}@([a-z0-9.-]+\.[a-z]{2,})$/);
  if (!m) return null;
  return allowedDomains().includes(m[1]) ? email : null;
}

const cleanText = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
const validPin = (pin) => /^\d{6}$/.test(String(pin || ''));

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(pin), salt, 32).toString('hex')}`;
}

function checkPin(pin, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(String(pin), salt, 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET(16자 이상)이 설정되지 않았어요.');
  return s;
}

const sign = (value) => crypto.createHmac('sha256', secret()).update(value).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function activeViewer(id) {
  return store.loadViewers().find((v) => v.id === id && !v.revokedAt) || null;
}

function makeSessionToken(viewer) {
  const payload = Buffer.from(JSON.stringify({ v: viewer.id, x: Date.now() + SESSION_DAYS * 86400000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

// 쿠키 서명이 맞고, 만료 전이고, 그 열람자가 지금도 승인 목록에 있어야 통과(회수하면 즉시 차단).
function readSession(req) {
  const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE_NAME + '='));
  if (!raw) return null;
  const [payload, sig] = decodeURIComponent(raw.slice(COOKIE_NAME.length + 1)).split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.v || data.x < Date.now()) return null;
    return activeViewer(data.v);
  } catch {
    return null;
  }
}

function setSessionCookie(res, req, value, maxAgeSec) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`
  );
}

function recentCount(map, key, windowMs) {
  const now = Date.now();
  const list = (map.get(key) || []).filter((t) => now - t < windowMs);
  map.set(key, list);
  return list;
}

const authRouter = express.Router();

// 열람 신청: 이름·부서·회사 메일·PIN. 같은 메일로 다시 신청하면 최신 신청으로 바꾼다.
authRouter.post('/request', (req, res) => {
  const ipList = recentCount(requestsByIp, req.ip, 3600000);
  if (ipList.length >= MAX_REQUESTS_PER_IP_HOUR) {
    return res.status(429).json({ error: '신청이 너무 많아요. 1시간 뒤에 다시 시도해주세요.' });
  }
  const name = cleanText(req.body?.name, 30);
  const dept = cleanText(req.body?.dept, 40);
  const email = normalizeEmail(req.body?.email);
  const pin = String(req.body?.pin || '');
  if (!name || !dept) return res.status(400).json({ error: '이름과 부서를 입력해주세요.' });
  if (!email) return res.status(400).json({ error: `회사 메일(${allowedDomains().map((d) => '@' + d).join(', ')})만 사용할 수 있어요.` });
  if (!validPin(pin)) return res.status(400).json({ error: 'PIN은 숫자 6자리로 정해주세요.' });

  if (store.loadViewers().some((v) => v.email === email && !v.revokedAt)) {
    return res.status(409).json({ error: '이미 승인된 메일이에요. 로그인 탭에서 로그인해주세요. PIN을 잊으셨다면 관리자에게 회수 후 재신청을 요청해주세요.' });
  }
  const requests = store.loadAccessRequests().filter((r) => r.email !== email);
  requests.push({
    id: `req_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    name,
    dept,
    email,
    pinHash: hashPin(pin),
    requestedAt: new Date().toISOString()
  });
  store.saveAccessRequests(requests.slice(-200));
  ipList.push(Date.now());
  console.log(`[auth] 열람 신청: ${name} / ${dept} / ${email}`);
  res.json({ ok: true });
});

authRouter.post('/login', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const pin = String(req.body?.pin || '');
  const ipFails = recentCount(failsByIp, req.ip, FAIL_WINDOW_MS);
  const emailFails = email ? recentCount(failsByEmail, email, FAIL_WINDOW_MS) : [];
  if (ipFails.length >= MAX_FAILS_PER_IP || emailFails.length >= MAX_FAILS_PER_EMAIL) {
    return res.status(429).json({ error: '로그인 실패가 많아요. 15분 뒤에 다시 시도해주세요.' });
  }
  const fail = (msg) => {
    ipFails.push(Date.now());
    if (email) emailFails.push(Date.now());
    return res.status(400).json({ error: msg });
  };
  if (!email || !validPin(pin)) return fail('회사 메일과 PIN(숫자 6자리)을 확인해주세요.');

  const viewer = store.loadViewers().find((v) => v.email === email && !v.revokedAt);
  if (!viewer) {
    const pendingReq = store.loadAccessRequests().some((r) => r.email === email);
    return fail(pendingReq ? '아직 승인 대기 중이에요. 승인되면 로그인할 수 있어요.' : '등록되지 않은 메일이에요. "열람 신청"을 먼저 해주세요.');
  }
  if (!checkPin(pin, viewer.pinHash)) return fail('PIN이 맞지 않아요.');

  failsByEmail.delete(email);
  setSessionCookie(res, req, makeSessionToken(viewer), SESSION_DAYS * 86400);
  console.log(`[auth] 로그인: ${viewer.name} (${viewer.email})`);
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  setSessionCookie(res, req, '', 0);
  res.json({ ok: true });
});

function requireAuth(req, res, next) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const open =
    req.path === '/login' ||
    req.path === '/healthz' ||
    req.path === '/robots.txt' ||
    req.path.startsWith('/api/auth/') ||
    req.path.startsWith('/api/admin/'); // 로컬 PC 전용 경로(관리자 비밀키로 따로 보호됨)
  if (open) return next();
  const viewer = readSession(req);
  if (viewer) {
    req.authUser = viewer.email;
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: '로그인이 필요해요.' });
  return res.redirect(302, '/login');
}

function mountAuth(app) {
  app.get('/healthz', (req, res) => res.type('text').send('ok'));
  app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));
  if (process.env.AUTH_REQUIRED !== 'true') return;
  secret(); // 설정 누락이면 서버 시작 시 바로 알 수 있게
  app.use(requireAuth);
  app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'views', 'login.html')));
  app.use('/api/auth', authRouter);
  console.log(`[auth] 열람 신청/승인 방식 켜짐: ${allowedDomains().map((d) => '@' + d).join(', ')}`);
}

module.exports = { mountAuth, normalizeEmail };
