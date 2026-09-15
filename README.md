# 동아일보 채용 인스타그램 AI 분석 대시보드

동아일보 채용 인스타그램 계정의 성과를 분석하고, 게시물을 채용 콘텐츠 카테고리(공고/인터뷰/사내문화/복지/이벤트)로 태깅해
어떤 콘텐츠가 효과적인지 자동으로 인사이트를 생성해주는 사내용 대시보드입니다.

## 빠른 시작 (데모 모드)

토큰 없이 샘플 데이터로 바로 실행해볼 수 있습니다.

```bash
npm install
npm start
```

브라우저에서 http://localhost:3000 접속.

## 실제 계정 연동

[SETUP.md](./SETUP.md) 문서를 따라 Meta 개발자 앱 등록과 액세스 토큰 발급을 진행한 뒤, `.env`에 값을 채우면
자동으로 "실서버 모드"로 전환됩니다. 대시보드의 "지금 동기화" 버튼으로 최신 데이터를 가져옵니다.

## 기존 유료 인스타그램 분석 툴과의 차이점

- **채용 콘텐츠 전용 카테고리 태깅**: 공고/인터뷰/사내문화/복지/이벤트별 성과 비교는 범용 SNS 분석 툴에는 없는 기능입니다.
- **룰 기반 AI 인사이트**: 통계를 바탕으로 한국어 추천 문구를 자동 생성합니다 (`lib/insights.js`). 외부 LLM 없이 동작하며,
  추후 필요하면 Claude API 등을 연동해 더 정교한 서술형 리포트로 확장할 수 있는 구조입니다.
- **완전 자체 호스팅**: 월 구독료가 없고, 데이터가 외부 서버로 나가지 않습니다.

## 폴더 구조

- `server.js` — Express 서버, 정적 파일 서빙 + API 라우트
- `routes/api.js` — `/api/dashboard`, `/api/sync`, `/api/posts/:id/tag`
- `lib/instagramApi.js` — Instagram Graph API 호출
- `lib/insights.js` — 룰 기반 인사이트 생성 로직
- `lib/store.js` — 로컬 JSON 파일 저장소 (`data/`)
- `lib/sampleData.js` — 데모 모드 샘플 데이터
- `public/` — 프론트엔드 (바닐라 HTML/CSS/JS + Chart.js)
- `scripts/refresh-token.js` — 액세스 토큰 갱신 CLI

## 브랜딩 커스터마이징

`public/css/style.css` 상단의 `--brand-navy`, `--brand-red` 값을 동아일보 정확한 CI 컬러 코드로 교체하세요.
로고를 넣으려면 `public/index.html`의 `.brand-mark` 부분을 실제 로고 이미지로 교체하면 됩니다.
