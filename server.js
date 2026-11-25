require('dotenv').config();
const express = require('express');
const path = require('path');
const apiRouter = require('./routes/api');
const { mountAuth } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1); // Render는 프록시 뒤에서 돌아서, https 여부를 X-Forwarded-Proto로 판단한다

// 게시물 직접 추가 시 첨부하는 썸네일 사진이 base64로 요청 본문에 실려오므로 기본 100kb보다 넉넉하게 잡는다.
app.use(express.json({ limit: '8mb' }));
// 공유용 사이트에서는(AUTH_REQUIRED=true) 회사 메일 인증을 통과해야 아래 화면/데이터에 접근할 수 있다.
mountAuth(app);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRouter);

app.listen(PORT, () => {
  const mode = process.env.IG_ACCESS_TOKEN && process.env.IG_BUSINESS_ACCOUNT_ID ? 'live' : 'demo';
  console.log(`[동아일보 채용 인스타그램 대시보드] http://localhost:${PORT} (${mode} 모드)`);
});
