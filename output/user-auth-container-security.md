> **Language / 언어**: [한국어](#ko) | [English](#en)

---

<a id="ko"></a>

# CC-on-Bedrock 사용자 인증, 컨테이너 할당, 보안/비용 제어

---

<a id="ko-account-creation"></a>
## 1. 사용자 신청 및 계정 생성

### 1.1 사용자 신청 프로세스

```
[사용자]                    [관리자]                       [시스템]
   │                          │                              │
   │  1. 계정 신청 요청        │                              │
   │  (이메일, 부서, 용도)     │                              │
   ├─────────────────────────>│                              │
   │                          │  2. Dashboard 접속            │
   │                          │  (Users 메뉴)                │
   │                          ├─────────────────────────────>│
   │                          │                              │
   │                          │  3. Create User 클릭          │
   │                          │  - 이메일 입력                │
   │                          │  - Subdomain 설정             │
   │                          │  - OS 선택 (Ubuntu/AL2023)    │
   │                          │  - Tier 선택 (Light/Std/Power)│
   │                          │  - Security Policy 선택       │
   │                          ├─────────────────────────────>│
   │                          │                              │
   │                          │                    4. Cognito │
   │                          │                    사용자 생성 │
   │                          │                              │
   │  5. 초대 이메일 수신      │                              │
   │  (임시 패스워드 포함)     │<─────────────────────────────│
   │<─────────────────────────│                              │
   │                          │                              │
   │  6. Dashboard 접속        │                              │
   │  임시 패스워드로 로그인    │                              │
   │  → 새 패스워드 설정       │                              │
   ├─────────────────────────────────────────────────────────>│
   │                          │                              │
```

### 1.2 사용자 생성 시 설정 항목

| 항목 | 설명 | 옵션 |
|------|------|------|
| **Email** | Cognito 로그인 ID (이메일 형식) | `user@company.com` |
| **Subdomain** | DevEnv 접속 URL 결정 | `user01` → `user01.dev.whchoi.net` |
| **Department** | 부서 (사용량 분석용) | engineering, data-science, product, devops, research |
| **Container OS** | 개발환경 OS | Ubuntu 24.04 / Amazon Linux 2023 |
| **Resource Tier** | 컨테이너 사양 | Light (1vCPU/4GiB), Standard (2vCPU/8GiB), Power (4vCPU/12GiB) |
| **Security Policy** | DLP 보안 등급 | Open / Restricted / Locked |

### 1.3 초대 이메일 내용

```
제목: [CC-on-Bedrock] Your development environment is ready

내용:
- Welcome 메시지
- YOUR CREDENTIALS: Username + Temporary Password
- HOW TO GET STARTED:
  1. Dashboard 접속 (https://cconbedrock-dashboard.whchoi.net)
  2. 임시 패스워드로 로그인
  3. 새 패스워드 설정
  4. 관리자에게 컨테이너 시작 요청
```

### 1.4 Cognito 그룹별 권한

| 그룹 | Dashboard 접근 | 기능 |
|------|---------------|------|
| **admin** | 전체 7페이지 | 사용자 CRUD, 컨테이너 시작/중지, 모니터링, 보안 설정 |
| **user** | Home, AI, Analytics | 자신의 사용량 조회, AI 어시스턴트 사용 |

---

<a id="ko-authentication"></a>
## 2. 사용자 인증 흐름

### 2.1 Dashboard 로그인 (OAuth 2.0 Authorization Code Grant)

```
┌──────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────┐
│  Browser │     │  CloudFront  │     │  Dashboard   │     │ Cognito  │
│          │     │  (CDN/HTTPS) │     │  (Next.js)   │     │ Hosted UI│
└────┬─────┘     └──────┬───────┘     └──────┬───────┘     └────┬─────┘
     │                   │                    │                   │
     │ 1. 접속            │                    │                   │
     │ cconbedrock-       │                    │                   │
     │ dashboard.whchoi.net                    │                   │
     ├──────────────────>│                    │                   │
     │                   │ 2. Forward         │                   │
     │                   │ (X-Custom-Secret)  │                   │
     │                   ├───────────────────>│                   │
     │                   │                    │                   │
     │                   │ 3. 302 Redirect    │                   │
     │                   │ (미인증 → signin)  │                   │
     │<──────────────────┤<───────────────────│                   │
     │                   │                    │                   │
     │ 4. "Sign in with Cognito" 클릭         │                   │
     ├──────────────────>│───────────────────>│                   │
     │                   │                    │                   │
     │                   │ 5. 302 Redirect to Cognito             │
     │                   │ + Set-Cookie: next-auth.state (암호화) │
     │<──────────────────┤<───────────────────│                   │
     │                   │                    │                   │
     │ 6. Cognito Hosted UI 로그인 페이지      │                   │
     ├──────────────────────────────────────────────────────────>│
     │                   │                    │                   │
     │ 7. 이메일 + 패스워드 입력               │                   │
     ├──────────────────────────────────────────────────────────>│
     │                   │                    │                   │
     │                   │                    │ 8. 인증 성공       │
     │                   │                    │ Authorization Code │
     │ 9. 302 Redirect   │                    │<──────────────────│
     │ callback?code=... │                    │                   │
     │<─────────────────────────────────────────────────────────│
     │                   │                    │                   │
     │ 10. Callback 요청  │                    │                   │
     ├──────────────────>│───────────────────>│                   │
     │                   │                    │                   │
     │                   │                    │ 11. Code → Token  │
     │                   │                    │ (server-to-server)│
     │                   │                    ├──────────────────>│
     │                   │                    │                   │
     │                   │                    │ 12. ID Token      │
     │                   │                    │ (groups, email,   │
     │                   │                    │  custom attributes)│
     │                   │                    │<──────────────────│
     │                   │                    │                   │
     │ 13. Set-Cookie:   │                    │                   │
     │ next-auth.session-token (JWT)          │                   │
     │ → Dashboard 홈으로 리다이렉트           │                   │
     │<──────────────────┤<───────────────────│                   │
     │                   │                    │                   │
```

### 2.2 인증 토큰에 포함되는 정보

```json
{
  "sub": "d478fd5c-40f1-70d1-1525-a6a9b6289606",
  "email": "admin01@whchoi.net",
  "groups": ["admin"],
  "subdomain": "admin01",
  "containerOs": "ubuntu",
  "resourceTier": "power",
  "securityPolicy": "open"
}
```

### 2.3 DevEnv 접속 (code-server 패스워드 인증)

```
┌──────────┐     ┌──────────────┐     ┌───────────┐     ┌──────────────┐
│  Browser │     │  CloudFront  │     │  ALB      │     │  ECS Task    │
│          │     │  (DevEnv)    │     │ (DevEnv)  │     │ (code-server)│
└────┬─────┘     └──────┬───────┘     └─────┬─────┘     └──────┬───────┘
     │                   │                   │                   │
     │ 1. 접속            │                   │                   │
     │ user01.dev.        │                   │                   │
     │ whchoi.net         │                   │                   │
     ├──────────────────>│                   │                   │
     │                   │ 2. Host 기반       │                   │
     │                   │ 라우팅             │                   │
     │                   ├──────────────────>│                   │
     │                   │                   │ 3. user01         │
     │                   │                   │ 타겟 그룹으로     │
     │                   │                   ├──────────────────>│
     │                   │                   │                   │
     │ 4. code-server 패스워드 입력 화면       │                   │
     │<──────────────────┤<──────────────────┤<──────────────────│
     │                   │                   │                   │
     │ 5. 패스워드 입력 (CcOnBedrock2026!)    │                   │
     ├──────────────────>│──────────────────>│──────────────────>│
     │                   │                   │                   │
     │ 6. VS Code 개발환경 (code-server)      │                   │
     │<──────────────────┤<──────────────────┤<──────────────────│
     │                   │                   │                   │
```

### 2.4 인증 방식 비교

| 항목 | Dashboard | DevEnv (code-server) |
|------|-----------|---------------------|
| **인증 방식** | Cognito OAuth 2.0 | 고정 패스워드 |
| **패스워드** | 사용자별 개별 설정 | `CcOnBedrock2026!` (전체 동일) |
| **세션 유지** | JWT (8시간) | code-server 세션 |
| **MFA** | Cognito 설정 가능 | 미지원 |
| **URL** | `cconbedrock-dashboard.whchoi.net` | `{subdomain}.dev.whchoi.net` |

---

<a id="ko-container-allocation"></a>
## 3. 컨테이너 할당 및 IAM 역할 제어

### 3.1 컨테이너 할당 프로세스

```
[관리자]                    [Dashboard API]              [AWS ECS]
   │                          │                           │
   │ 1. Containers 메뉴       │                           │
   │    → Start Container     │                           │
   │    → 사용자 선택          │                           │
   ├─────────────────────────>│                           │
   │                          │                           │
   │                          │ 2. 중복 검사               │
   │                          │ (동일 username/subdomain   │
   │                          │  RUNNING/PENDING 태스크?)  │
   │                          │                           │
   │                          │ 중복 시 → 409 Conflict     │
   │                          │                           │
   │                          │ 3. RunTask API 호출        │
   │                          │ - Task Definition 선택     │
   │                          │   ({OS}-{Tier})           │
   │                          │ - Security Group 선택      │
   │                          │   (Open/Restricted/Locked) │
   │                          │ - 환경변수 주입             │
   │                          │ - 태그 부착 (username,     │
   │                          │   subdomain, department)   │
   │                          ├─────────────────────────>│
   │                          │                           │
   │                          │            4. Task 생성    │
   │                          │            PROVISIONING    │
   │                          │<─────────────────────────│
   │                          │                           │
   │                          │ 5. ALB 타겟 등록           │
   │                          │ (비동기, 30초 대기)        │
   │                          │ subdomain.dev.whchoi.net   │
   │                          │ → Container Private IP     │
   │                          │                           │
   │ 6. 컨테이너 시작 완료     │                           │
   │ TaskArn 반환              │                           │
   │<─────────────────────────│                           │
   │                          │                           │
```

### 3.2 Task Definition → Security Group 매핑

```
사용자 설정                    Task Definition              Security Group
─────────────                ─────────────────           ──────────────────
OS: Ubuntu
Tier: Standard     ──────>   devenv-ubuntu-standard
Policy: Open       ──────────────────────────────────>   sg-devenv-open

OS: AL2023
Tier: Power        ──────>   devenv-al2023-power
Policy: Locked     ──────────────────────────────────>   sg-devenv-locked
```

### 3.3 컨테이너 환경변수 주입

| 환경변수 | 값 | 용도 |
|---------|-----|------|
| `CLAUDE_CODE_USE_BEDROCK` | `1` | Claude Code가 Bedrock Direct 모드 사용 |
| `SECURITY_POLICY` | `open/restricted/locked` | code-server DLP 정책 적용 |
| `USER_SUBDOMAIN` | `user01` | 사용자 식별 |
| `CODESERVER_PASSWORD` | `CcOnBedrock2026!` | code-server 로그인 패스워드 |
| `AWS_DEFAULT_REGION` | `ap-northeast-2` | AWS 서비스 리전 |

### 3.4 IAM 역할 구조

```
┌─────────────────────────────────────────────────────────────┐
│                        IAM 역할 구조                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ECS Task Role (cc-on-bedrock-ecs-task)             │    │
│  │                                                     │    │
│  │  컨테이너 내부에서 사용하는 역할                       │    │
│  │  ─────────────────────────────────────              │    │
│  │  • bedrock:InvokeModel                → Bedrock 호출│    │
│  │  • bedrock:InvokeModelWithResponseStream            │    │
│  │  • bedrock:Converse                                 │    │
│  │  • bedrock:ConverseStream                           │    │
│  │  • s3:GetObject, s3:PutObject         → 파일 저장   │    │
│  │  • logs:CreateLogStream               → 로그 기록   │    │
│  │  • ecr:GetAuthorizationToken          → 이미지 풀   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ECS Task Execution Role                            │    │
│  │  (cc-on-bedrock-ecs-task-execution)                 │    │
│  │                                                     │    │
│  │  ECS 에이전트가 태스크 시작 시 사용                    │    │
│  │  ─────────────────────────────────────              │    │
│  │  • ecr:GetDownloadUrlForLayer         → 이미지 다운  │    │
│  │  • ecr:BatchGetImage                                │    │
│  │  • logs:CreateLogGroup                → 로그 그룹   │    │
│  │  • secretsmanager:GetSecretValue      → 시크릿 조회 │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Dashboard EC2 Role                                 │    │
│  │  (cc-on-bedrock-dashboard-ec2)                      │    │
│  │                                                     │    │
│  │  Dashboard 서버가 AWS 서비스 호출 시 사용              │    │
│  │  ─────────────────────────────────────              │    │
│  │  • ecs:RunTask, StopTask, TagResource → 컨테이너 관리│    │
│  │  • cognito-idp:Admin*                 → 사용자 관리  │    │
│  │  • dynamodb:Scan, Query               → 사용량 조회  │    │
│  │  • bedrock:InvokeModel                → AI 어시스턴트│    │
│  │  • elasticloadbalancing:*             → ALB 타겟 관리│    │
│  │  • cloudwatch:GetMetricData           → 모니터링     │    │
│  │  • cloudtrail:LookupEvents            → 보안 감사    │    │
│  │  • iam:PassRole                       → ECS Role 전달│    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Lambda Execution Roles                             │    │
│  │                                                     │    │
│  │  usage-tracker Lambda:                              │    │
│  │  • dynamodb:PutItem, UpdateItem       → 사용량 기록  │    │
│  │  • ecs:ListTasks, DescribeTasks       → 태스크 조회  │    │
│  │                                                     │    │
│  │  budget-check Lambda:                               │    │
│  │  • dynamodb:Scan                      → 비용 집계    │    │
│  │  • ecs:StopTask                       → 초과 시 중지 │    │
│  │  • cognito-idp:AdminUpdateUser        → 플래그 설정  │    │
│  │  • sns:Publish                        → 알림 전송    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.5 Bedrock 모델 접근 제어 (IAM Policy)

```
┌──────────────────────────────────────────────────────┐
│  기본 사용자 (user 그룹)                               │
│                                                      │
│  Allow:                                              │
│  • claude-sonnet-4-6-v1         (Sonnet 4.6)        │
│  • claude-haiku-4-5-20251001    (Haiku 4.5)         │
│                                                      │
│  Deny (암묵적):                                       │
│  • claude-opus-4-6-v1           (Opus 4.6)          │
│  → 고비용 모델 접근 차단                               │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  관리자 (admin 그룹)                                   │
│                                                      │
│  Allow:                                              │
│  • claude-opus-4-6-v1           (Opus 4.6)          │
│  • claude-sonnet-4-6-v1         (Sonnet 4.6)        │
│  • claude-haiku-4-5-20251001    (Haiku 4.5)         │
│  → 전체 모델 접근 가능                                 │
└──────────────────────────────────────────────────────┘
```

---

<a id="ko-cost-control"></a>
## 4. 비용 제어

### 4.1 사용량 추적 파이프라인

```
[ECS Task]          [CloudTrail]      [EventBridge]     [Lambda]         [DynamoDB]
    │                    │                │                │                │
    │ InvokeModel        │                │                │                │
    │ (Bedrock API)      │                │                │                │
    ├───────────────────>│                │                │                │
    │                    │                │                │                │
    │                    │ API Call Event  │                │                │
    │                    ├───────────────>│                │                │
    │                    │                │                │                │
    │                    │                │ Trigger        │                │
    │                    │                ├───────────────>│                │
    │                    │                │                │                │
    │                    │                │                │ PutItem        │
    │                    │                │                │ PK: USER#user01│
    │                    │                │                │ SK: 2026-03-24 │
    │                    │                │                │    #model-id   │
    │                    │                │                ├───────────────>│
    │                    │                │                │                │
```

### 4.2 DynamoDB 데이터 구조

```
┌─────────────────────────────────────────────────────────┐
│  Table: cc-on-bedrock-usage                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  사용자별 레코드:                                         │
│  PK: USER#engineering-01                                │
│  SK: 2026-03-24#claude-sonnet-4-6-v1                   │
│  ─────────────────────────────                          │
│  department: engineering                                │
│  inputTokens: 15000                                     │
│  outputTokens: 8000                                     │
│  totalTokens: 23000                                     │
│  requests: 45                                           │
│  estimatedCost: 0.165                                   │
│  latencySumMs: 135000                                   │
│                                                         │
│  부서별 집계 레코드:                                      │
│  PK: DEPT#engineering                                   │
│  SK: 2026-03-24                                         │
│  ─────────────────────                                  │
│  inputTokens: 120000                                    │
│  outputTokens: 65000                                    │
│  requests: 380                                          │
│  estimatedCost: 1.325                                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.3 예산 차단 프로세스

```
[Lambda: budget-check]                              [IAM]            [Cognito]
    │ (5분마다 실행)                                   │                │
    │                                                  │                │
    │ 1. DynamoDB Scan                                 │                │
    │    → 오늘 날짜 사용자별 비용 합산                   │                │
    │                                                  │                │
    │ 2. 사용자별 일일 예산 비교                          │                │
    │    DAILY_BUDGET_USD: $50                          │                │
    │                                                  │                │
    │ ┌─── 예산 80% 도달 ───┐                           │                │
    │ │                      │                          │                │
    │ │ 3a. SNS 경고 알림    │                          │                │
    │ │ "user01 has used     │                          │                │
    │ │  80% of daily budget"│                          │                │
    │ └──────────────────────┘                          │                │
    │                                                  │                │
    │ ┌─── 예산 100% 초과 ──┐                           │                │
    │ │                      │                          │                │
    │ │ 3b. IAM Deny Policy  │                          │                │
    │ │ 동적 부착             │                          │                │
    │ │ → Bedrock 호출 차단  ├─────────────────────────>│                │
    │ │                      │                          │                │
    │ │ 3c. Cognito 플래그   │                          │                │
    │ │ budget_exceeded=true ├──────────────────────────────────────────>│
    │ │                      │                          │                │
    │ │ 3d. SNS 차단 알림    │                          │                │
    │ │ "user01 BLOCKED:     │                          │                │
    │ │  exceeded daily limit"│                          │                │
    │ └──────────────────────┘                          │                │
    │                                                  │                │
    │ ┌─── 다음 날 자동 해제 ┐                           │                │
    │ │                      │                          │                │
    │ │ 4. Deny Policy 제거  ├─────────────────────────>│                │
    │ │ budget_exceeded=false ├──────────────────────────────────────────>│
    │ └──────────────────────┘                          │                │
```

### 4.4 비용 예측 (모델별)

| 모델 | Input (1M tokens) | Output (1M tokens) | 5분 최대 비용 | 일일 예상 비용 (일반) |
|------|-------------------|--------------------|--------------|---------------------|
| **Opus 4.6** | $15.00 | $75.00 | ~$75 | $20~50 |
| **Sonnet 4.6** | $3.00 | $15.00 | ~$15 | $5~15 |
| **Haiku 4.5** | $0.80 | $4.00 | ~$4 | $1~5 |

### 4.5 Dashboard 비용 모니터링

```
┌─────────────────────────────────────────────────────┐
│  Analytics 페이지 제공 정보                            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  • 7일/30일 총 비용 및 일별 트렌드                     │
│  • 모델별 사용 비율 (Opus vs Sonnet vs Haiku)         │
│  • 부서별 비용 분포                                   │
│  • 사용자 리더보드 (상위 비용 사용자)                   │
│  • 토큰 사용량 (Input/Output 비율)                    │
│  • 월간 예상 비용 (현재 추세 기반)                      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

<a id="ko-security-control"></a>
## 5. 보안 제어

### 5.1 DLP (Data Loss Prevention) 3-Tier 보안 정책

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  OPEN (Education/Lab)                                   │  │
│  │                                                         │  │
│  │  Security Group: 0.0.0.0/0 (전체 아웃바운드 허용)        │  │
│  │  code-server: 파일 업/다운로드 허용                       │  │
│  │  DNS Firewall: 기본 위협 리스트만 차단                    │  │
│  │  Extensions: 자유 설치                                   │  │
│  │                                                         │  │
│  │  용도: 교육, 실험, PoC                                   │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  RESTRICTED (General Production)                        │  │
│  │                                                         │  │
│  │  Security Group: VPC CIDR + 화이트리스트 IP만 허용       │  │
│  │  code-server: 파일 다운로드 차단, 업로드 차단             │  │
│  │  DNS Firewall: 위협 리스트 + 커스텀 도메인 차단          │  │
│  │  Extensions: 승인된 목록만 설치 가능                      │  │
│  │                                                         │  │
│  │  용도: 일반 개발, 프로덕션 코드 작업                      │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  LOCKED (High Security)                                 │  │
│  │                                                         │  │
│  │  Security Group: VPC CIDR만 허용 (인터넷 접근 불가)      │  │
│  │  code-server: 파일 업/다운로드 완전 차단                  │  │
│  │  DNS Firewall: 최대 제한                                 │  │
│  │  Extensions: 읽기 전용 (사전 설치된 것만 사용)            │  │
│  │                                                         │  │
│  │  용도: 민감 데이터 처리, 규정 준수 환경                    │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 5.2 네트워크 보안 레이어

```
Internet
    │
    ▼
┌──────────────────────────────────────────┐
│  Layer 1: CloudFront                     │
│  • HTTPS 강제 (TLS 1.2+)                │
│  • AWS Shield (DDoS 방어)                │
│  • 글로벌 엣지 캐싱                       │
└──────────────────┬───────────────────────┘
                   │ X-Custom-Secret Header
                   ▼
┌──────────────────────────────────────────┐
│  Layer 2: ALB                            │
│  • CloudFront Prefix List (직접 접근 차단)│
│  • X-Custom-Secret 헤더 검증             │
│  • Host 기반 라우팅                       │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Layer 3: Security Groups                │
│  • Open / Restricted / Locked            │
│  • 인바운드: ALB에서만 허용 (8080)        │
│  • 아웃바운드: 정책별 차등 적용            │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Layer 4: VPC Endpoints                  │
│  • Bedrock API: VPC 내부 통신만           │
│  • ECR, SSM, CloudWatch: Private Link    │
│  • 인터넷 경유 없는 AWS 서비스 접근       │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Layer 5: DNS Firewall                   │
│  • AWS 관리 위협 도메인 리스트 (5종)      │
│  • 커스텀 차단 도메인                     │
│  • VPC 레벨 DNS 쿼리 필터링              │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Layer 6: IAM + Bedrock                  │
│  • 모델별 접근 제어 (Opus/Sonnet/Haiku)  │
│  • 사용자별 Task Role                    │
│  • 예산 초과 시 동적 Deny Policy          │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Layer 7: Application (code-server DLP)  │
│  • 파일 업로드/다운로드 제어              │
│  • VS Code 확장 프로그램 제한             │
│  • IMDSv2 강제                           │
└──────────────────────────────────────────┘
```

### 5.3 보안 체크리스트

| 항목 | 상태 | 세부 사항 |
|------|------|----------|
| Cognito 사용자 인증 | ✅ | OAuth 2.0 + OIDC |
| CloudFront HTTPS | ✅ | ACM `*.whchoi.net` |
| VPC Endpoints (Private Link) | ✅ | 8개 엔드포인트 |
| KMS 암호화 | ✅ | EBS, Secrets Manager |
| Secrets Manager | ✅ | NextAuth, CloudFront |
| DNS Firewall | ✅ | Restricted 규칙 적용 |
| Security Groups (3-tier DLP) | ✅ | Open/Restricted/Locked |
| ECS Exec | ✅ | initProcessEnabled + SSM |
| EFS 전송 암호화 | ✅ | TLS enabled |
| IMDSv2 강제 | ✅ | AL2023 default |
| IAM 기반 사용량 제어 | ✅ | 사용자별 Task Role |
| DynamoDB 사용량 추적 | ✅ | CloudTrail → Lambda → DDB |

### 5.4 감사 및 모니터링

| 도구 | 용도 | 대시보드 페이지 |
|------|------|---------------|
| **CloudTrail** | 모든 API 호출 기록, Bedrock 사용 추적 | Security |
| **CloudWatch Container Insights** | ECS CPU/Memory/Network 실시간 메트릭 | Monitoring |
| **CloudWatch Logs** | 컨테이너 로그, Lambda 실행 로그 | Monitoring |
| **DNS Firewall 로그** | 차단된 DNS 쿼리 기록 | Security |
| **DynamoDB** | 사용자별/모델별/부서별 사용량 | Analytics |

---

<a id="ko-lifecycle"></a>
## 6. 전체 수명주기 요약

```
1. 신청     관리자가 Dashboard에서 사용자 생성
                ↓
2. 인증     사용자가 이메일로 임시 패스워드 수신 → Dashboard 로그인 → 패스워드 변경
                ↓
3. 할당     관리자가 컨테이너 시작 (OS/Tier/Security Policy 기반)
                ↓
4. 사용     사용자가 DevEnv 접속 → Claude Code로 개발
                ↓
5. 추적     CloudTrail → Lambda → DynamoDB (자동, 실시간)
                ↓
6. 제어     예산 초과 시 IAM Deny Policy 자동 부착 + SNS 알림
                ↓
7. 분석     Dashboard Analytics에서 비용/토큰/모델 트렌드 확인
                ↓
8. 정리     관리자가 컨테이너 중지 (또는 2시간 무활동 자동 중지)
                ↓
9. 보존     EFS에 작업 데이터 유지 → 다음 시작 시 복원
```

---

<a id="en"></a>

# CC-on-Bedrock User Authentication, Container Allocation, Security/Cost Control

---

<a id="en-account-creation"></a>
## 1. User Registration and Account Creation

### 1.1 User Registration Process

```
[User]                      [Admin]                        [System]
   │                          │                              │
   │  1. Account request      │                              │
   │  (email, dept, purpose)  │                              │
   ├─────────────────────────>│                              │
   │                          │  2. Access Dashboard         │
   │                          │  (Users menu)                │
   │                          ├─────────────────────────────>│
   │                          │                              │
   │                          │  3. Click Create User        │
   │                          │  - Enter email               │
   │                          │  - Set Subdomain             │
   │                          │  - Select OS (Ubuntu/AL2023) │
   │                          │  - Select Tier (Light/Std/   │
   │                          │    Power)                    │
   │                          │  - Select Security Policy    │
   │                          ├─────────────────────────────>│
   │                          │                              │
   │                          │                   4. Cognito │
   │                          │                   user create│
   │                          │                              │
   │  5. Invitation email     │                              │
   │  (with temp password)    │<─────────────────────────────│
   │<─────────────────────────│                              │
   │                          │                              │
   │  6. Access Dashboard     │                              │
   │  Login with temp password│                              │
   │  → Set new password      │                              │
   ├─────────────────────────────────────────────────────────>│
   │                          │                              │
```

### 1.2 User Creation Settings

| Field | Description | Options |
|-------|-------------|---------|
| **Email** | Cognito login ID (email format) | `user@company.com` |
| **Subdomain** | Determines DevEnv access URL | `user01` → `user01.dev.whchoi.net` |
| **Department** | Department (for usage analytics) | engineering, data-science, product, devops, research |
| **Container OS** | Development environment OS | Ubuntu 24.04 / Amazon Linux 2023 |
| **Resource Tier** | Container specs | Light (1vCPU/4GiB), Standard (2vCPU/8GiB), Power (4vCPU/12GiB) |
| **Security Policy** | DLP security level | Open / Restricted / Locked |

### 1.3 Invitation Email Content

```
Subject: [CC-on-Bedrock] Your development environment is ready

Content:
- Welcome message
- YOUR CREDENTIALS: Username + Temporary Password
- HOW TO GET STARTED:
  1. Access Dashboard (https://cconbedrock-dashboard.whchoi.net)
  2. Login with temporary password
  3. Set new password
  4. Request container start from admin
```

### 1.4 Cognito Group Permissions

| Group | Dashboard Access | Features |
|-------|-----------------|----------|
| **admin** | All 7 pages | User CRUD, container start/stop, monitoring, security settings |
| **user** | Home, AI, Analytics | View own usage, use AI assistant |

---

<a id="en-authentication"></a>
## 2. User Authentication Flow

### 2.1 Dashboard Login (OAuth 2.0 Authorization Code Grant)

```
┌──────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────┐
│  Browser │     │  CloudFront  │     │  Dashboard   │     │ Cognito  │
│          │     │  (CDN/HTTPS) │     │  (Next.js)   │     │ Hosted UI│
└────┬─────┘     └──────┬───────┘     └──────┬───────┘     └────┬─────┘
     │                   │                    │                   │
     │ 1. Access          │                    │                   │
     │ cconbedrock-       │                    │                   │
     │ dashboard.whchoi.net                    │                   │
     ├──────────────────>│                    │                   │
     │                   │ 2. Forward         │                   │
     │                   │ (X-Custom-Secret)  │                   │
     │                   ├───────────────────>│                   │
     │                   │                    │                   │
     │                   │ 3. 302 Redirect    │                   │
     │                   │ (unauth → signin)  │                   │
     │<──────────────────┤<───────────────────│                   │
     │                   │                    │                   │
     │ 4. Click "Sign in with Cognito"        │                   │
     ├──────────────────>│───────────────────>│                   │
     │                   │                    │                   │
     │                   │ 5. 302 Redirect to Cognito             │
     │                   │ + Set-Cookie: next-auth.state (encrypted)│
     │<──────────────────┤<───────────────────│                   │
     │                   │                    │                   │
     │ 6. Cognito Hosted UI login page        │                   │
     ├──────────────────────────────────────────────────────────>│
     │                   │                    │                   │
     │ 7. Enter email + password              │                   │
     ├──────────────────────────────────────────────────────────>│
     │                   │                    │                   │
     │                   │                    │ 8. Auth success   │
     │                   │                    │ Authorization Code │
     │ 9. 302 Redirect   │                    │<──────────────────│
     │ callback?code=... │                    │                   │
     │<─────────────────────────────────────────────────────────│
     │                   │                    │                   │
     │ 10. Callback request│                   │                   │
     ├──────────────────>│───────────────────>│                   │
     │                   │                    │                   │
     │                   │                    │ 11. Code → Token  │
     │                   │                    │ (server-to-server)│
     │                   │                    ├──────────────────>│
     │                   │                    │                   │
     │                   │                    │ 12. ID Token      │
     │                   │                    │ (groups, email,   │
     │                   │                    │  custom attributes)│
     │                   │                    │<──────────────────│
     │                   │                    │                   │
     │ 13. Set-Cookie:   │                    │                   │
     │ next-auth.session-token (JWT)          │                   │
     │ → Redirect to Dashboard home           │                   │
     │<──────────────────┤<───────────────────│                   │
     │                   │                    │                   │
```

### 2.2 Information Included in Auth Token

```json
{
  "sub": "d478fd5c-40f1-70d1-1525-a6a9b6289606",
  "email": "admin01@whchoi.net",
  "groups": ["admin"],
  "subdomain": "admin01",
  "containerOs": "ubuntu",
  "resourceTier": "power",
  "securityPolicy": "open"
}
```

### 2.3 DevEnv Access (code-server Password Authentication)

```
┌──────────┐     ┌──────────────┐     ┌───────────┐     ┌──────────────┐
│  Browser │     │  CloudFront  │     │  ALB      │     │  ECS Task    │
│          │     │  (DevEnv)    │     │ (DevEnv)  │     │ (code-server)│
└────┬─────┘     └──────┬───────┘     └─────┬─────┘     └──────┬───────┘
     │                   │                   │                   │
     │ 1. Access          │                   │                   │
     │ user01.dev.        │                   │                   │
     │ whchoi.net         │                   │                   │
     ├──────────────────>│                   │                   │
     │                   │ 2. Host-based     │                   │
     │                   │ routing           │                   │
     │                   ├──────────────────>│                   │
     │                   │                   │ 3. Route to       │
     │                   │                   │ user01 target grp │
     │                   │                   ├──────────────────>│
     │                   │                   │                   │
     │ 4. code-server password prompt        │                   │
     │<──────────────────┤<──────────────────┤<──────────────────│
     │                   │                   │                   │
     │ 5. Enter password (CcOnBedrock2026!)  │                   │
     ├──────────────────>│──────────────────>│──────────────────>│
     │                   │                   │                   │
     │ 6. VS Code dev environment (code-server)                  │
     │<──────────────────┤<──────────────────┤<──────────────────│
     │                   │                   │                   │
```

### 2.4 Authentication Method Comparison

| Item | Dashboard | DevEnv (code-server) |
|------|-----------|---------------------|
| **Auth Method** | Cognito OAuth 2.0 | Fixed password |
| **Password** | Per-user individual | `CcOnBedrock2026!` (shared) |
| **Session Duration** | JWT (8 hours) | code-server session |
| **MFA** | Configurable via Cognito | Not supported |
| **URL** | `cconbedrock-dashboard.whchoi.net` | `{subdomain}.dev.whchoi.net` |

---

<a id="en-container-allocation"></a>
## 3. Container Allocation and IAM Role Control

### 3.1 Container Allocation Process

```
[Admin]                     [Dashboard API]              [AWS ECS]
   │                          │                           │
   │ 1. Containers menu      │                           │
   │    → Start Container     │                           │
   │    → Select user         │                           │
   ├─────────────────────────>│                           │
   │                          │                           │
   │                          │ 2. Duplicate check        │
   │                          │ (Same username/subdomain   │
   │                          │  RUNNING/PENDING task?)    │
   │                          │                           │
   │                          │ Duplicate → 409 Conflict   │
   │                          │                           │
   │                          │ 3. RunTask API call        │
   │                          │ - Select Task Definition   │
   │                          │   ({OS}-{Tier})           │
   │                          │ - Select Security Group    │
   │                          │   (Open/Restricted/Locked) │
   │                          │ - Inject env variables     │
   │                          │ - Attach tags (username,   │
   │                          │   subdomain, department)   │
   │                          ├─────────────────────────>│
   │                          │                           │
   │                          │          4. Task created   │
   │                          │          PROVISIONING      │
   │                          │<─────────────────────────│
   │                          │                           │
   │                          │ 5. Register ALB target    │
   │                          │ (async, 30s wait)         │
   │                          │ subdomain.dev.whchoi.net   │
   │                          │ → Container Private IP     │
   │                          │                           │
   │ 6. Container started     │                           │
   │ TaskArn returned          │                           │
   │<─────────────────────────│                           │
   │                          │                           │
```

### 3.2 Task Definition → Security Group Mapping

```
User Settings                  Task Definition              Security Group
─────────────                ─────────────────           ──────────────────
OS: Ubuntu
Tier: Standard     ──────>   devenv-ubuntu-standard
Policy: Open       ──────────────────────────────────>   sg-devenv-open

OS: AL2023
Tier: Power        ──────>   devenv-al2023-power
Policy: Locked     ──────────────────────────────────>   sg-devenv-locked
```

### 3.3 Container Environment Variables

| Env Variable | Value | Purpose |
|-------------|-------|---------|
| `CLAUDE_CODE_USE_BEDROCK` | `1` | Claude Code uses Bedrock Direct mode |
| `SECURITY_POLICY` | `open/restricted/locked` | Applies code-server DLP policy |
| `USER_SUBDOMAIN` | `user01` | User identification |
| `CODESERVER_PASSWORD` | `CcOnBedrock2026!` | code-server login password |
| `AWS_DEFAULT_REGION` | `ap-northeast-2` | AWS service region |

### 3.4 IAM Role Structure

```
┌─────────────────────────────────────────────────────────────┐
│                      IAM Role Structure                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ECS Task Role (cc-on-bedrock-ecs-task)             │    │
│  │                                                     │    │
│  │  Role used inside containers                        │    │
│  │  ─────────────────────────────────────              │    │
│  │  • bedrock:InvokeModel              → Bedrock calls │    │
│  │  • bedrock:InvokeModelWithResponseStream            │    │
│  │  • bedrock:Converse                                 │    │
│  │  • bedrock:ConverseStream                           │    │
│  │  • s3:GetObject, s3:PutObject       → File storage  │    │
│  │  • logs:CreateLogStream             → Log writing   │    │
│  │  • ecr:GetAuthorizationToken        → Image pull    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ECS Task Execution Role                            │    │
│  │  (cc-on-bedrock-ecs-task-execution)                 │    │
│  │                                                     │    │
│  │  Used by ECS agent when starting tasks              │    │
│  │  ─────────────────────────────────────              │    │
│  │  • ecr:GetDownloadUrlForLayer       → Image download│    │
│  │  • ecr:BatchGetImage                                │    │
│  │  • logs:CreateLogGroup              → Log groups    │    │
│  │  • secretsmanager:GetSecretValue    → Secret lookup │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Dashboard EC2 Role                                 │    │
│  │  (cc-on-bedrock-dashboard-ec2)                      │    │
│  │                                                     │    │
│  │  Used by Dashboard server for AWS service calls     │    │
│  │  ─────────────────────────────────────              │    │
│  │  • ecs:RunTask, StopTask, TagResource → Container mgmt│  │
│  │  • cognito-idp:Admin*               → User mgmt    │    │
│  │  • dynamodb:Scan, Query             → Usage query   │    │
│  │  • bedrock:InvokeModel              → AI assistant  │    │
│  │  • elasticloadbalancing:*           → ALB target mgmt│   │
│  │  • cloudwatch:GetMetricData         → Monitoring    │    │
│  │  • cloudtrail:LookupEvents          → Security audit│    │
│  │  • iam:PassRole                     → ECS Role pass │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Lambda Execution Roles                             │    │
│  │                                                     │    │
│  │  usage-tracker Lambda:                              │    │
│  │  • dynamodb:PutItem, UpdateItem     → Usage logging │    │
│  │  • ecs:ListTasks, DescribeTasks     → Task lookup   │    │
│  │                                                     │    │
│  │  budget-check Lambda:                               │    │
│  │  • dynamodb:Scan                    → Cost aggregate│    │
│  │  • ecs:StopTask                     → Stop on exceed│    │
│  │  • cognito-idp:AdminUpdateUser      → Set flag      │    │
│  │  • sns:Publish                      → Send alert    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.5 Bedrock Model Access Control (IAM Policy)

```
┌──────────────────────────────────────────────────────┐
│  Regular Users (user group)                          │
│                                                      │
│  Allow:                                              │
│  • claude-sonnet-4-6-v1         (Sonnet 4.6)        │
│  • claude-haiku-4-5-20251001    (Haiku 4.5)         │
│                                                      │
│  Deny (implicit):                                    │
│  • claude-opus-4-6-v1           (Opus 4.6)          │
│  → Block access to high-cost models                  │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  Administrators (admin group)                        │
│                                                      │
│  Allow:                                              │
│  • claude-opus-4-6-v1           (Opus 4.6)          │
│  • claude-sonnet-4-6-v1         (Sonnet 4.6)        │
│  • claude-haiku-4-5-20251001    (Haiku 4.5)         │
│  → Full model access                                │
└──────────────────────────────────────────────────────┘
```

---

<a id="en-cost-control"></a>
## 4. Cost Control

### 4.1 Usage Tracking Pipeline

```
[ECS Task]          [CloudTrail]      [EventBridge]     [Lambda]         [DynamoDB]
    │                    │                │                │                │
    │ InvokeModel        │                │                │                │
    │ (Bedrock API)      │                │                │                │
    ├───────────────────>│                │                │                │
    │                    │                │                │                │
    │                    │ API Call Event  │                │                │
    │                    ├───────────────>│                │                │
    │                    │                │                │                │
    │                    │                │ Trigger        │                │
    │                    │                ├───────────────>│                │
    │                    │                │                │                │
    │                    │                │                │ PutItem        │
    │                    │                │                │ PK: USER#user01│
    │                    │                │                │ SK: 2026-03-24 │
    │                    │                │                │    #model-id   │
    │                    │                │                ├───────────────>│
    │                    │                │                │                │
```

### 4.2 DynamoDB Data Structure

```
┌─────────────────────────────────────────────────────────┐
│  Table: cc-on-bedrock-usage                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Per-user record:                                       │
│  PK: USER#engineering-01                                │
│  SK: 2026-03-24#claude-sonnet-4-6-v1                   │
│  ─────────────────────────────                          │
│  department: engineering                                │
│  inputTokens: 15000                                     │
│  outputTokens: 8000                                     │
│  totalTokens: 23000                                     │
│  requests: 45                                           │
│  estimatedCost: 0.165                                   │
│  latencySumMs: 135000                                   │
│                                                         │
│  Per-department aggregate record:                       │
│  PK: DEPT#engineering                                   │
│  SK: 2026-03-24                                         │
│  ─────────────────────                                  │
│  inputTokens: 120000                                    │
│  outputTokens: 65000                                    │
│  requests: 380                                          │
│  estimatedCost: 1.325                                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.3 Budget Enforcement Process

```
[Lambda: budget-check]                              [IAM]            [Cognito]
    │ (runs every 5 min)                              │                │
    │                                                  │                │
    │ 1. DynamoDB Scan                                 │                │
    │    → Aggregate per-user cost for today            │                │
    │                                                  │                │
    │ 2. Compare against daily budget                  │                │
    │    DAILY_BUDGET_USD: $50                          │                │
    │                                                  │                │
    │ ┌─── 80% threshold ──┐                           │                │
    │ │                      │                          │                │
    │ │ 3a. SNS warning      │                          │                │
    │ │ "user01 has used     │                          │                │
    │ │  80% of daily budget"│                          │                │
    │ └──────────────────────┘                          │                │
    │                                                  │                │
    │ ┌─── 100% exceeded ──┐                           │                │
    │ │                      │                          │                │
    │ │ 3b. IAM Deny Policy  │                          │                │
    │ │ dynamic attach       │                          │                │
    │ │ → Block Bedrock calls├─────────────────────────>│                │
    │ │                      │                          │                │
    │ │ 3c. Cognito flag     │                          │                │
    │ │ budget_exceeded=true ├──────────────────────────────────────────>│
    │ │                      │                          │                │
    │ │ 3d. SNS block alert  │                          │                │
    │ │ "user01 BLOCKED:     │                          │                │
    │ │  exceeded daily limit"│                          │                │
    │ └──────────────────────┘                          │                │
    │                                                  │                │
    │ ┌─── Next-day auto reset┐                         │                │
    │ │                      │                          │                │
    │ │ 4. Remove Deny Policy├─────────────────────────>│                │
    │ │ budget_exceeded=false ├──────────────────────────────────────────>│
    │ └──────────────────────┘                          │                │
```

### 4.4 Cost Estimates (Per Model)

| Model | Input (1M tokens) | Output (1M tokens) | 5-min Max Cost | Daily Est. Cost (typical) |
|-------|-------------------|--------------------|----------------|--------------------------|
| **Opus 4.6** | $15.00 | $75.00 | ~$75 | $20~50 |
| **Sonnet 4.6** | $3.00 | $15.00 | ~$15 | $5~15 |
| **Haiku 4.5** | $0.80 | $4.00 | ~$4 | $1~5 |

### 4.5 Dashboard Cost Monitoring

```
┌─────────────────────────────────────────────────────┐
│  Analytics Page Information                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  • 7-day/30-day total cost and daily trends         │
│  • Per-model usage ratio (Opus vs Sonnet vs Haiku)  │
│  • Per-department cost distribution                 │
│  • User leaderboard (top cost users)                │
│  • Token usage (Input/Output ratio)                 │
│  • Monthly projected cost (based on current trend)  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

<a id="en-security-control"></a>
## 5. Security Control

### 5.1 DLP (Data Loss Prevention) 3-Tier Security Policy

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  OPEN (Education/Lab)                                   │  │
│  │                                                         │  │
│  │  Security Group: 0.0.0.0/0 (all outbound allowed)      │  │
│  │  code-server: File upload/download allowed              │  │
│  │  DNS Firewall: Only basic threat lists blocked          │  │
│  │  Extensions: Free installation                          │  │
│  │                                                         │  │
│  │  Use case: Education, experiments, PoC                  │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  RESTRICTED (General Production)                        │  │
│  │                                                         │  │
│  │  Security Group: VPC CIDR + whitelisted IPs only        │  │
│  │  code-server: File download blocked, upload blocked     │  │
│  │  DNS Firewall: Threat lists + custom domain blocking    │  │
│  │  Extensions: Only approved list installable             │  │
│  │                                                         │  │
│  │  Use case: General development, production code work    │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  LOCKED (High Security)                                 │  │
│  │                                                         │  │
│  │  Security Group: VPC CIDR only (no internet access)     │  │
│  │  code-server: File upload/download fully blocked        │  │
│  │  DNS Firewall: Maximum restriction                      │  │
│  │  Extensions: Read-only (pre-installed only)             │  │
│  │                                                         │  │
│  │  Use case: Sensitive data processing, compliance envs   │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 5.2 Network Security Layers

```
Internet
    │
    ▼
┌──────────────────────────────────────────┐
│  Layer 1: CloudFront                     │
│  • HTTPS enforced (TLS 1.2+)            │
│  • AWS Shield (DDoS protection)          │
│  • Global edge caching                   │
└──────────────────┬───────────────────────┘
                   │ X-Custom-Secret Header
                   ▼
┌──────────────────────────────────────────┐
│  Layer 2: ALB                            │
│  • CloudFront Prefix List (block direct) │
│  • X-Custom-Secret header verification   │
│  • Host-based routing                    │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Layer 3: Security Groups                │
│  • Open / Restricted / Locked            │
│  • Inbound: Only from ALB (8080)         │
│  • Outbound: Policy-based differentiation│
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Layer 4: VPC Endpoints                  │
│  • Bedrock API: VPC internal only        │
│  • ECR, SSM, CloudWatch: Private Link    │
│  • AWS service access without internet   │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Layer 5: DNS Firewall                   │
│  • AWS managed threat domain lists (5)   │
│  • Custom block domains                  │
│  • VPC-level DNS query filtering         │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Layer 6: IAM + Bedrock                  │
│  • Per-model access control (Opus/Sonnet/Haiku) │
│  • Per-user Task Role                    │
│  • Dynamic Deny Policy on budget exceed  │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Layer 7: Application (code-server DLP)  │
│  • File upload/download control          │
│  • VS Code extension restrictions        │
│  • IMDSv2 enforced                       │
└──────────────────────────────────────────┘
```

### 5.3 Security Checklist

| Item | Status | Details |
|------|--------|---------|
| Cognito User Authentication | ✅ | OAuth 2.0 + OIDC |
| CloudFront HTTPS | ✅ | ACM `*.whchoi.net` |
| VPC Endpoints (Private Link) | ✅ | 8 endpoints |
| KMS Encryption | ✅ | EBS, Secrets Manager |
| Secrets Manager | ✅ | NextAuth, CloudFront |
| DNS Firewall | ✅ | Restricted rules applied |
| Security Groups (3-tier DLP) | ✅ | Open/Restricted/Locked |
| ECS Exec | ✅ | initProcessEnabled + SSM |
| EFS Transit Encryption | ✅ | TLS enabled |
| IMDSv2 Enforced | ✅ | AL2023 default |
| IAM-based Usage Control | ✅ | Per-user Task Role |
| DynamoDB Usage Tracking | ✅ | CloudTrail → Lambda → DDB |

### 5.4 Audit and Monitoring

| Tool | Purpose | Dashboard Page |
|------|---------|---------------|
| **CloudTrail** | Records all API calls, tracks Bedrock usage | Security |
| **CloudWatch Container Insights** | Real-time ECS CPU/Memory/Network metrics | Monitoring |
| **CloudWatch Logs** | Container logs, Lambda execution logs | Monitoring |
| **DNS Firewall Logs** | Records blocked DNS queries | Security |
| **DynamoDB** | Per-user/model/department usage | Analytics |

---

<a id="en-lifecycle"></a>
## 6. Full Lifecycle Summary

```
1. Request    Admin creates user in Dashboard
                ↓
2. Auth       User receives temp password via email → Dashboard login → Change password
                ↓
3. Allocate   Admin starts container (based on OS/Tier/Security Policy)
                ↓
4. Use        User accesses DevEnv → Develops with Claude Code
                ↓
5. Track      CloudTrail → Lambda → DynamoDB (automatic, real-time)
                ↓
6. Control    On budget exceed → Auto-attach IAM Deny Policy + SNS notification
                ↓
7. Analyze    Review cost/token/model trends in Dashboard Analytics
                ↓
8. Cleanup    Admin stops container (or auto-stop after 2hr idle)
                ↓
9. Preserve   Work data retained on EFS → Restored on next start
```
