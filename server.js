require('dotenv').config();
const express = require('express');
const path = require('path');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRouter);

app.listen(PORT, () => {
  const mode = process.env.IG_ACCESS_TOKEN && process.env.IG_BUSINESS_ACCOUNT_ID ? 'live' : 'demo';
  console.log(`[동아일보 채용 인스타그램 대시보드] http://localhost:${PORT} (${mode} 모드)`);
});
