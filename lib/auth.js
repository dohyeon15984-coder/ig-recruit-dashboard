// 공유용 사이트(Render) 접근 제한: 회사 메일(@donga.com, @ichannela.com)로 받은 6자리 인증번호를
// 입력한 사람만 대시보드를 볼 수 있게 한다. AUTH_REQUIRED=true 인 서버에서만 켜진다(로컬 PC는 그대로).
//
// - 인증번호는 메모리에만 보관(10분 만료, 시도 5회 제한). 서버가 재시작되면 새로 받으면 된다.
// - 로그인 상태는 서명된 쿠키(AUTH_SECRET으로 HMAC 서명)로 유지해서, 무료 서버가 재시작돼도 풀리지 않는다.
// - 메일은 Brevo의 HTTP API로 보낸다(BREVO_API_KEY, MAIL_FROM). 무료 호스팅이 메일 포트를 막아도 동작한다.

const crypto = require('crypto');
const express = require('express');
const path = require('path');

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODES_PER_HOUR = 5;
const SESSION_DAYS = 30;
const COOKIE_NAME = 'ig_dash_session';

const pending = new Map(); // email -> { hash, expires, attempts }
const sendLog = new Map(); // email -> [timestamps]

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

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET(16자 이상)이 설정되지 않았어요.');
  return s;
}

const hmac = (value) => crypto.createHmac('sha256', secret()).update(value).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function makeSessionToken(email) {
  const payload = Buffer.from(JSON.stringify({ e: email, x: Date.now() + SESSION_DAYS * 86400000 })).toString('base64url');
  return `${payload}.${hmac(payload)}`;
}

function readSession(req) {
  const cookie = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE_NAME + '='));
  if (!cookie) return null;
  const [payload, sig] = decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)).split('.');
  if (!payload || !sig || !safeEqual(sig, hmac(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.e || data.x < Date.now() || !normalizeEmail(data.e)) return null;
    return { email: data.e };
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

async function sendCodeMail(email, code) {
  if (!process.env.BREVO_API_KEY || !process.env.MAIL_FROM) {
    if (process.env.AUTH_DEV_LOG_CODES === 'true') {
      console.log(`[auth] (테스트 모드) ${email} 인증번호: ${code}`);
      return;
    }
    throw new Error('메일 발송 설정(BREVO_API_KEY, MAIL_FROM)이 없어요. 관리자에게 알려주세요.');
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'api-key': process.env.BREVO_API_KEY },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM, name: process.env.MAIL_FROM_NAME || '동아일보 채용 대시보드' },
      to: [{ email }],
      subject: `[채용 대시보드] 인증번호 ${code}`,
      textContent: `동아일보 채용 인스타그램 대시보드 인증번호는 ${code} 입니다.\n10분 안에 입력해주세요.\n\n본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다.`
    })
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[auth] 메일 발송 실패:', res.status, body.slice(0, 300));
    throw new Error('인증 메일을 보내지 못했어요. 잠시 후 다시 시도해주세요.');
  }
}

const authRouter = express.Router();

authRouter.post('/request-code', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) {
    return res.status(400).json({ error: `회사 메일(${allowedDomains().map((d) => '@' + d).join(', ')})만 사용할 수 있어요.` });
  }
  const now = Date.now();
  const recent = (sendLog.get(email) || []).filter((t) => now - t < 3600000);
  if (recent.length && now - recent[recent.length - 1] < RESEND_COOLDOWN_MS) {
    return res.status(429).json({ error: '인증번호를 방금 보냈어요. 1분 뒤에 다시 요청해주세요.' });
  }
  if (recent.length >= MAX_CODES_PER_HOUR) {
    return res.status(429).json({ error: '요청이 너무 많아요. 1시간 뒤에 다시 시도해주세요.' });
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  try {
    await sendCodeMail(email, code);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
  pending.set(email, { hash: hmac(`${email}:${code}`), expires: now + CODE_TTL_MS, attempts: 0 });
  recent.push(now);
  sendLog.set(email, recent);
  res.json({ ok: true });
});

authRouter.post('/verify', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || '').trim();
  const entry = email && pending.get(email);
  if (!entry || entry.expires < Date.now()) {
    return res.status(400).json({ error: '인증번호가 만료됐어요. 다시 받아주세요.' });
  }
  entry.attempts++;
  if (entry.attempts > MAX_ATTEMPTS) {
    pending.delete(email);
    return res.status(400).json({ error: '시도 횟수를 넘었어요. 인증번호를 다시 받아주세요.' });
  }
  if (!/^\d{6}$/.test(code) || !safeEqual(hmac(`${email}:${code}`), entry.hash)) {
    return res.status(400).json({ error: `인증번호가 맞지 않아요. (${MAX_ATTEMPTS - entry.attempts}번 남음)` });
  }
  pending.delete(email);
  setSessionCookie(res, req, makeSessionToken(email), SESSION_DAYS * 86400);
  console.log(`[auth] 로그인: ${email}`);
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  setSessionCookie(res, req, '', 0);
  res.json({ ok: true });
});

// AUTH_REQUIRED=true 일 때 로그인하지 않은 요청을 막는다.
function requireAuth(req, res, next) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const open =
    req.path === '/login' ||
    req.path === '/healthz' ||
    req.path === '/robots.txt' ||
    req.path.startsWith('/api/auth/') ||
    req.path === '/api/admin/import'; // 로컬 PC가 데이터를 밀어넣는 경로(관리자 비밀키로 따로 보호됨)
  if (open) return next();
  const session = readSession(req);
  if (session) {
    req.authUser = session.email;
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
  console.log(`[auth] 회사 메일 인증 켜짐: ${allowedDomains().map((d) => '@' + d).join(', ')}`);
}

module.exports = { mountAuth, normalizeEmail };
