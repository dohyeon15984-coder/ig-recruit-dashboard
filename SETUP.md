# Instagram Graph API 연동 설정 가이드

이 문서는 **계정 관리자(담당자)**가 직접 진행해야 하는 단계입니다. 결제는 없지만, Meta 쪽 승인/설정 절차라 다른 사람이 대신 해줄 수 없습니다.

## 1. 인스타그램을 비즈니스/크리에이터 계정으로 전환

인스타그램 앱 → 설정 → 계정 → "프로페셔널 계정으로 전환" → 비즈니스 선택.

## 2. Facebook 페이지와 연결

이미 동아일보 채용 관련 Facebook 페이지가 있다면 연결하고, 없다면 간단한 페이지를 하나 새로 만들어 연결합니다. (Instagram Graph API는 반드시 연결된 Facebook 페이지를 통해 접근합니다.)

## 3. Meta 개발자 앱 생성

1. https://developers.facebook.com/apps 접속 (Facebook 계정으로 로그인)
2. "앱 만들기" → 유형은 **비즈니스** 선택
3. 생성된 앱 대시보드에서 "제품 추가" → **Instagram Graph API** 추가

## 4. 내 계정을 테스터/관리자로 등록

앱이 "개발 모드(Development Mode)"인 동안에는 Meta의 정식 심사(App Review) 없이도 **앱 역할이 있는 계정 본인의 데이터**에는 접근할 수 있습니다.

- 앱 대시보드 → 역할(Roles) → 본인의 Facebook 계정을 관리자로 추가 (이미 앱을 만든 본인이면 자동으로 포함됨)

## 5. 액세스 토큰 발급

1. https://developers.facebook.com/tools/explorer 접속
2. 우측 상단에서 방금 만든 앱 선택
3. "User or Page" → 연결된 Facebook 페이지 선택
4. 권한(Permissions)에서 아래 항목 체크:
   - `instagram_basic`
   - `instagram_manage_insights`
   - `pages_show_list`
   - `pages_read_engagement`
5. "Generate Access Token" 클릭 → 단기 토큰 발급 (유효기간 1시간)

## 6. 단기 토큰 → 60일 장기 토큰으로 교환

이 프로젝트에 포함된 스크립트를 사용합니다.

```bash
npm install
```

`.env` 파일을 만들고 (`.env.example` 복사) `FB_APP_ID`, `FB_APP_SECRET`을 채워넣습니다 (앱 대시보드 → 설정 → 기본 설정에서 확인).

```bash
node scripts/refresh-token.js <5번에서_발급받은_단기_토큰>
```

출력된 장기 토큰과 오늘 날짜를 `.env`에 반영합니다:

```
IG_ACCESS_TOKEN=발급받은_장기_토큰
IG_TOKEN_ISSUED_AT=2026-09-10
```

> 장기 토큰은 약 60일간 유효합니다. 대시보드 상단에 만료 D-day 배너가 표시되니, 만료 전에 4~6번을 반복해 갱신하세요.

## 7. Instagram 비즈니스 계정 ID 확인

Graph API Explorer에서 아래 쿼리를 순서대로 실행합니다.

1. `GET /me/accounts` → 연결된 Facebook 페이지 ID 확인
2. `GET /{페이지_ID}?fields=instagram_business_account` → `instagram_business_account.id` 값이 필요한 계정 ID입니다

이 값을 `.env`의 `IG_BUSINESS_ACCOUNT_ID`에 입력합니다.

## 8. 실행

```bash
npm start
```

`.env`에 `IG_ACCESS_TOKEN`, `IG_BUSINESS_ACCOUNT_ID`가 모두 채워져 있으면 자동으로 "실서버 모드"로 전환됩니다. 대시보드 상단의 "지금 동기화" 버튼을 눌러 실제 데이터를 가져오세요.
