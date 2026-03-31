# CC-on-Bedrock 프로젝트 리뷰 v3 (2026-03-31)

> Reviewer: Kiro CLI | Scope: 전체 (CDK 6 stacks, Next.js 75 files, Docker, Lambda, Scripts)
> Delta from: v2 (2026-03-29 07:22)

---

## 이전 이슈 해결 현황

### Next.js (이전 26건)

| # | 심각도 | 이슈 | 상태 |
|---|--------|------|------|
| 1 | CRASH | /api/dept DynamoDB 키 불일치 (PK vs dept_id) | ✅ FIXED |
| 2 | CRASH | approval-requests 테이블 미존재 | ⚠️ PARTIAL (catch 추가, 테이블은 여전히 없음) |
| 3 | CRASH | /api/admin/budgets PUT dept 키 불일치 | ❌ REMAINS |
| 4 | CRASH | /api/admin/budgets PUT user 키 불일치 | ❌ REMAINS |
| 5 | CRASH | /api/admin/budgets GET 파싱 키 불일치 | ⚠️ PARTIAL (fallback 추가, PUT은 여전히 오류) |
| 6 | CRASH | /api/ai POST req.json() try/catch 없음 | ❌ REMAINS |
| 7 | CRASH | /api/ai/memory POST req.json() try/catch 없음 | ❌ REMAINS |
| 8 | CRASH | AI 페이지 admin-only 제한 | ❌ REMAINS |
| 9 | ERROR | Home 비관리자 /api/containers 403 | ❌ REMAINS |
| 10 | ERROR | /api/security 빈 SG ID | ❌ REMAINS |
| 11 | ERROR | /api/usage 빈 user.id 데이터 유출 | ✅ FIXED |
| 12 | ERROR | handleToggle DELETE 메서드 | ❌ REMAINS |
| 13 | ERROR | Storage type 기본값 불일치 | ⚠️ PARTIAL (일부 통일, admin vs user 불일치 잔존) |
| 14 | ERROR | /api/dept/list 부서명 파싱 오류 | ✅ FIXED |
| 15 | ERROR | userPoolId 빈 문자열 | ❌ REMAINS |
| 16 | ERROR | AWS_ACCOUNT_ID 빈 문자열 | ❌ REMAINS |
| 17 | WARN | Error boundary 없음 | ❌ REMAINS |
| 18 | WARN | toUsageRecord PK 크래시 | ✅ FIXED |
| 19 | WARN | 클러스터명 불일치 | ⚠️ PARTIAL |
| 20 | WARN | AI stale closure | ⬇️ 하향 (per-request 정상) |
| 21 | WARN | Budget/token 에러 상태 | ⚠️ PARTIAL |
| 22 | WARN | 라이트 테마 차트 | ❌ REMAINS (다크 모드 강제로 완화) |
| 23 | WARN | Security 리다이렉트 불일치 | ✅ FIXED |
| 24 | WARN | Dept 리프레시 로딩 | ✅ FIXED |
| 25 | WARN | Silent data loss (승인) | ❌ REMAINS |
| 26 | WARN | Analytics 구조 분해 | ✅ FIXED |

**요약: 7건 FIXED, 4건 PARTIAL, 14건 REMAINS, 1건 하향**

### CDK (이전 28건 중 주요)

| 이슈 | 상태 |
|------|------|
| EFS root directory 격리 | ⚠️ PARTIAL (entrypoint에서 처리, CDK 미강제) |
| DNS Firewall 미구현 | ❌ REMAINS |
| LiteLLM 리소스 잔존 | ⚠️ PARTIAL (CDK 스택 제거, secrets/role 잔존) |
| Lambda wildcard ECS 권한 | ❌ REMAINS |
| Nginx 프록시 과잉 권한 | ❌ REMAINS |
| Dashboard .env 디스크 잔존 | ⚠️ PARTIAL (런타임 fetch, 파일은 잔존) |
| Hardcoded Bedrock 가격 | ❌ REMAINS |
| ALB+NLB 이중 구조 | ✅ FIXED (NLB+Nginx 단일화) |
| WAF WebACL 이름 | ✅ FIXED |
| GSI 설계 오류 | ✅ FIXED |
| ASG termination 불일치 | ✅ FIXED |

**요약: 4건 FIXED, 4건 PARTIAL, 12건 REMAINS**

---

## 신규 이슈

### 🔴 CRASH (2건)

#### NEW-1. Home 페이지 크래시 — 미존재 import (`BarChart3`, `Activity`)
- **파일:** `home-dashboard.tsx`
- **영향:** `BarChart3`, `Activity`가 lucide-react에서 import 안 됨 → ReferenceError → 홈 페이지 빈 화면
- **수정:** import 추가: `import { BarChart3, Activity } from "lucide-react"`

#### NEW-2. Home 페이지 — 존재하지 않는 API 엔드포인트 호출
- **파일:** `home-dashboard.tsx:110-114`
- **영향:** `/api/spend/daily`, `/api/admin/containers`, `/api/admin/metrics/models`, `/api/admin/metrics/cloudwatch` — 이 라우트들이 코드베이스에 없음 → 404
- **수정:** 실제 API 경로로 수정 (`/api/usage?action=spend_per_day`, `/api/containers` 등)

### 🟠 ERROR (4건)

#### NEW-3. /api/user/container — getDeptAllowedTiers 키 불일치
- **파일:** `api/user/container/route.ts:27`
- **영향:** `Key: { dept_id: { S: department } }` 사용하지만 다른 곳은 `PK: { S: "DEPT#..." }` → 항상 빈 결과 → 티어 제한 미적용
- **수정:** 테이블 스키마에 맞게 키 통일

#### NEW-4. /api/user/container/stream — 동일 키 불일치
- **파일:** `api/user/container/stream/route.ts:28`
- **영향:** NEW-3과 동일한 버그 복제

#### NEW-5. Missing i18n 키 (home-dashboard)
- **파일:** `home-dashboard.tsx`
- **영향:** `home.totalTokens`, `home.costTrend`, `home.modelUsage`, `home.activeContainers` — 번역 키 미정의 → 원시 키 문자열 표시

#### NEW-6. nav.logout i18n 키 오류 (sidebar)
- **파일:** `components/sidebar.tsx`
- **영향:** `t("nav.logout")` 사용하지만 정의된 키는 `nav.signout` → "nav.logout" 문자열 표시

### 🟡 WARN (7건)

| 이슈 | 파일 |
|------|------|
| Nginx task role에 Bedrock 권한 (CDK) | `04-ecs-devenv-stack.ts` |
| EBS lifecycle Lambda wildcard ec2:Create* | `04-ecs-devenv-stack.ts` |
| warm-stop Lambda wildcard lambda:Invoke | `03-usage-tracking-stack.ts` |
| CloudFront secret hardcoded ARN suffix | `04-ecs-devenv-stack.ts` |
| 라우팅 테이블 KMS 암호화 없음 | `04-ecs-devenv-stack.ts` |
| validate-deployment.sh 하드코딩된 리소스 ID | `scripts/validate-deployment.sh` |
| Docker build.sh 여전히 litellm 빌드 | `docker/build.sh` |

---

## 현재 이슈 총괄

| 심각도 | 잔존 | 신규 | 합계 |
|--------|:----:|:----:|:----:|
| CRASH | 4 | 2 | **6** |
| ERROR | 6 | 4 | **10** |
| WARN | 12 | 7 | **19** |
| **합계** | **22** | **13** | **35** |

> v2 대비: 총 64→35 (45% 감소). CRASH 8→6, ERROR 8→10 (신규 포함)

---

## 개선 하이라이트 🎉

v2 대비 주요 개선:
1. **NLB+Nginx 단일화** — ALB+NLB 이중 구조 해소
2. **Bedrock Invocation Logging** — 정확한 토큰 추적
3. **WAF 양쪽 CloudFront 적용** — DevEnv + Dashboard
4. **IMDS 차단** — ECS_AWSVPC_BLOCK_IMDS + IMDSv2
5. **감사 로깅** — 전용 Lambda + DynamoDB
6. **배포 검증 스크립트** — validate-deployment.sh
7. **DynamoDB 키 수정** — /api/dept, /api/dept/list 정상화
8. **Usage 데이터 유출 수정** — 비관리자 자기 데이터만 조회
9. **GSI 설계 수정** — 부서 쿼리 정상화
10. **Analytics 안전한 구조 분해** — undefined 가드 추가

---

## 우선순위 로드맵

### 즉시 (CRASH)
1. `home-dashboard.tsx` — `BarChart3`, `Activity` import 추가 + API 경로 수정
2. `/api/admin/budgets` PUT — DynamoDB 키 수정 (`dept_id`, `user_id`)
3. `/api/ai` POST — `req.json()` try/catch 추가
4. AI 페이지 접근 제어 수정 (admin→all)

### 단기 (ERROR)
5. `getDeptAllowedTiers` 키 통일 (container, stream 라우트)
6. i18n 키 추가 (home-dashboard, sidebar)
7. Home 비관리자 admin API 호출 제거
8. handleToggle HTTP 메서드 수정
9. 빈 env var 검증 (userPoolId, AWS_ACCOUNT_ID, SG IDs)

### 중기 (WARN + CDK)
10. Nginx 전용 Task Role 분리
11. Error boundary 추가
12. DNS Firewall 구현
13. DynamoDB 테이블 암호화/TTL 통일
14. LiteLLM 잔존 아티팩트 최종 제거
