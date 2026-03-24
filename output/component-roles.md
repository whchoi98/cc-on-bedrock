> **Language / 언어**: [한국어](#ko) | [English](#en)

---

<a id="ko"></a>

# CC-on-Bedrock 컴포넌트별 역할

<a id="ko-user-access-path"></a>
## 사용자 접속 경로

```
Browser → CloudFront → ALB → EC2/ECS → AWS Services
```

---

<a id="ko-network-layer"></a>
## 네트워크 계층 (Stack 01: Network)

| 컴포넌트 | 역할 |
|----------|------|
| **VPC** (10.100.0.0/16) | 모든 리소스가 배치되는 가상 네트워크. 외부 인터넷과 격리된 사설 네트워크 공간 |
| **Public Subnet** (2 AZ) | 인터넷에서 직접 접근 가능한 서브넷. ALB, NAT Gateway 배치 |
| **Private Subnet** (2 AZ) | 인터넷에서 직접 접근 불가. ECS 컨테이너, Dashboard EC2 배치. NAT를 통해 외부 접속 |
| **NAT Gateway** (x2) | Private Subnet의 리소스가 인터넷에 접근할 수 있게 해주는 게이트웨이. AZ별 1개씩 (고가용성) |
| **VPC Endpoints** (8개) | AWS 서비스(Bedrock, ECR, SSM, CloudWatch, S3 등)에 인터넷 없이 VPC 내부 경로로 접근. 보안 강화 + 비용 절감 |
| **Route 53** | DNS 서비스. `*.dev.whchoi.net` → DevEnv CloudFront, `cconbedrock-dashboard.whchoi.net` → Dashboard CloudFront |
| **DNS Firewall** | VPC 레벨 DNS 필터링. 악성 도메인 차단 (5개 AWS 관리 위협 리스트 + 커스텀 차단 목록) |

---

<a id="ko-security-layer"></a>
## 보안 계층 (Stack 02: Security)

| 컴포넌트 | 역할 |
|----------|------|
| **Cognito User Pool** | 사용자 인증/관리 서비스. 이메일+패스워드 로그인, 사용자 생성/삭제, 그룹(admin/user) 관리 |
| **Cognito Hosted UI** | Cognito가 제공하는 로그인 웹페이지. `cc-on-bedrock.auth.amazoncognito.com`에서 호스팅 |
| **ACM** (Certificate Manager) | SSL/TLS 인증서 관리. `*.whchoi.net` 와일드카드 인증서 → CloudFront + ALB에서 HTTPS 제공 |
| **KMS** (Key Management Service) | 암호화 키 관리. EBS, Secrets Manager, DynamoDB 데이터 암호화에 사용 |
| **Secrets Manager** | 민감 정보 저장소. NextAuth Secret, CloudFront 시크릿 헤더 값 등 안전하게 보관 |
| **IAM Roles** | 각 서비스의 AWS 권한 정의. ECS Task Role (Bedrock 호출), Dashboard EC2 Role (Cognito/ECS/DynamoDB 관리) |

---

<a id="ko-usage-tracking"></a>
## 사용량 추적 (Stack 03: Usage Tracking)

| 컴포넌트 | 역할 |
|----------|------|
| **CloudTrail** | 모든 AWS API 호출 기록. Bedrock `InvokeModel` 호출을 감지하여 이벤트 발생 |
| **EventBridge** | 이벤트 라우터. CloudTrail의 Bedrock API 이벤트를 감지해서 Lambda 트리거 |
| **Lambda** (usage-tracker) | Bedrock API 호출 정보(사용자, 모델, 토큰)를 DynamoDB에 기록 |
| **Lambda** (budget-check) | 5분마다 실행. 사용자별 비용 합산 → 예산 초과 시 IAM Deny Policy 부착 + SNS 알림 |
| **DynamoDB** | 사용량 데이터 저장소. `PK: USER#{username}, SK: {date}#{model}` 구조. Dashboard가 조회 |
| **SNS** | 예산 초과 알림 전송 (이메일/SMS 등으로 관리자 통보) |

---

<a id="ko-devenv-container"></a>
## DevEnv 컨테이너 (Stack 04: ECS Dev Environment)

| 컴포넌트 | 역할 |
|----------|------|
| **CloudFront** (DevEnv) | CDN + HTTPS 종단. `*.dev.whchoi.net` 요청을 ALB로 전달. DDoS 방어, 글로벌 엣지 |
| **ALB** (DevEnv) | 로드밸런서. **Host 기반 라우팅** — `user01.dev.whchoi.net` → user01 컨테이너, `user02.dev.whchoi.net` → user02 컨테이너 |
| **ECS Cluster** (EC2 모드) | 컨테이너 오케스트레이션. Docker 컨테이너 스케줄링, 배치, 헬스체크 |
| **EC2 Host** (m7g.4xlarge x8) | ECS 컨테이너가 실제 실행되는 물리 인스턴스. ARM64 Graviton3, 16vCPU/64GiB |
| **Task Definition** (6종) | 컨테이너 스펙 정의. `{OS} x {Tier}` = Ubuntu/AL2023 x Light/Standard/Power |
| **ECS Task** | 실행 중인 컨테이너 인스턴스. 사용자 1명당 1개. code-server + Claude Code + Kiro |
| **EFS** (Elastic File System) | 공유 파일 스토리지. `/home/coder` 마운트. 컨테이너 재시작해도 작업 데이터 유지 |
| **Security Groups** (3종) | 네트워크 방화벽. **Open** (전체 허용) / **Restricted** (제한적) / **Locked** (VPC 내부만) |

---

<a id="ko-dashboard"></a>
## Dashboard (Stack 05: Dashboard)

| 컴포넌트 | 역할 |
|----------|------|
| **CloudFront** (Dashboard) | CDN + HTTPS 종단. `cconbedrock-dashboard.whchoi.net` → ALB. X-Custom-Secret 헤더로 직접 ALB 접근 차단 |
| **ALB** (Dashboard) | 로드밸런서. CloudFront에서 온 요청만 받음 (Prefix List + Secret Header 검증) |
| **EC2 ASG** (t4g.xlarge) | Dashboard 서버. Next.js standalone 앱을 PM2로 실행. Min:1 / Max:2 오토스케일링 |
| **Next.js App** | 7페이지 웹 대시보드. 사용량 분석, 모니터링, 사용자/컨테이너 관리, AI 어시스턴트 |
| **S3** (Deploy Bucket) | Dashboard 배포 아티팩트 저장. `npm run build` → tar.gz → S3 업로드 → EC2가 다운로드 |

---

<a id="ko-ai-ml-services"></a>
## AI/ML 서비스

| 컴포넌트 | 역할 |
|----------|------|
| **Amazon Bedrock** | AI 모델 호스팅. Claude Opus 4.6 / Sonnet 4.6 모델 제공. ECS Task가 직접 호출 (Direct Mode) |
| **Bedrock VPC Endpoint** | Bedrock API를 VPC 내부에서 호출. 트래픽이 인터넷을 거치지 않음 → 보안 + 저지연 |
| **AgentCore Memory** | AI Assistant의 대화 기억 저장. 이전 대화 맥락을 유지하여 연속적 상담 가능 |

---

<a id="ko-data-flow"></a>
## 데이터 흐름 요약

### 사용자 로그인

```
Browser → CloudFront → ALB → Next.js → Cognito OAuth → 인증 완료
```

### 컨테이너 사용 (Claude Code 개발)

```
Browser → CloudFront → ALB (Host 라우팅) → ECS Task (code-server)
code-server 안에서: Claude Code → ECS Task Role → VPC Endpoint → Bedrock
```

### 사용량 추적

```
Bedrock API Call → CloudTrail → EventBridge → Lambda → DynamoDB
Dashboard → DynamoDB 조회 → Analytics 차트 표시
```

### 예산 제어

```
Lambda (5분마다) → DynamoDB 스캔 → 초과 시 → IAM Deny Policy + SNS 알림
```

---

<a id="ko-security-defense"></a>
## 보안 다층 방어

```
Layer 1: CloudFront          (HTTPS 종단, DDoS 방어)
Layer 2: ALB                 (X-Custom-Secret 헤더 검증, Prefix List)
Layer 3: Cognito             (OAuth 2.0 사용자 인증)
Layer 4: Security Groups     (네트워크 레벨 접근 제어, 3-tier DLP)
Layer 5: DNS Firewall        (도메인 기반 필터링, 위협 리스트)
Layer 6: IAM                 (Bedrock 모델별 접근 제어, 사용자별 Task Role)
Layer 7: DLP                 (code-server 파일 업/다운로드 제한, 확장 프로그램 제어)
```

---

<a id="ko-task-definition"></a>
## Task Definition 사양표

| Task Definition | OS | vCPU | Memory | 용도 |
|----------------|-----|------|--------|------|
| devenv-ubuntu-light | Ubuntu 24.04 | 1 | 4 GiB | 경량 작업, 문서 편집 |
| devenv-ubuntu-standard | Ubuntu 24.04 | 2 | 8 GiB | 일반 개발 (기본) |
| devenv-ubuntu-power | Ubuntu 24.04 | 4 | 12 GiB | 대규모 빌드, ML 작업 |
| devenv-al2023-light | Amazon Linux 2023 | 1 | 4 GiB | AWS 네이티브 경량 작업 |
| devenv-al2023-standard | Amazon Linux 2023 | 2 | 8 GiB | AWS 네이티브 일반 개발 |
| devenv-al2023-power | Amazon Linux 2023 | 4 | 12 GiB | AWS 네이티브 대규모 작업 |

---

<a id="ko-dashboard-pages"></a>
## Dashboard 페이지 구성

| 페이지 | 접근 권한 | 주요 기능 |
|--------|----------|----------|
| Home | 전체 | 비용/토큰/사용자/컨테이너 요약, 클러스터 메트릭 |
| AI Assistant | 전체 | Bedrock Converse API 기반 대화형 AI, AgentCore Memory |
| Analytics | 전체 | 모델별 사용량, 부서별 비용, 일별 트렌드, 사용자 리더보드 |
| Monitoring | admin | Container Insights (CPU/Memory/Network), ECS 상태 |
| Security | admin | IAM 정책, DLP 현황, DNS Firewall 규칙, 보안 체크리스트 |
| Users | admin | Cognito 사용자 CRUD, 소팅/필터, 보안 정책 배정 |
| Containers | admin | ECS 컨테이너 시작/중지, 소팅/필터, 중복 방지 |

---

<a id="en"></a>

# CC-on-Bedrock Component Roles

<a id="en-user-access-path"></a>
## User Access Path

```
Browser → CloudFront → ALB → EC2/ECS → AWS Services
```

---

<a id="en-network-layer"></a>
## Network Layer (Stack 01: Network)

| Component | Role |
|-----------|------|
| **VPC** (10.100.0.0/16) | Virtual network where all resources are deployed. Isolated private network space separated from the public internet |
| **Public Subnet** (2 AZ) | Subnets directly accessible from the internet. ALB and NAT Gateway are placed here |
| **Private Subnet** (2 AZ) | Not directly accessible from the internet. ECS containers and Dashboard EC2 are placed here. Access external resources via NAT |
| **NAT Gateway** (x2) | Gateway that allows resources in Private Subnets to access the internet. One per AZ for high availability |
| **VPC Endpoints** (8) | Access AWS services (Bedrock, ECR, SSM, CloudWatch, S3, etc.) via internal VPC paths without internet. Enhanced security + cost savings |
| **Route 53** | DNS service. `*.dev.whchoi.net` → DevEnv CloudFront, `cconbedrock-dashboard.whchoi.net` → Dashboard CloudFront |
| **DNS Firewall** | VPC-level DNS filtering. Blocks malicious domains (5 AWS-managed threat lists + custom block list) |

---

<a id="en-security-layer"></a>
## Security Layer (Stack 02: Security)

| Component | Role |
|-----------|------|
| **Cognito User Pool** | User authentication/management service. Email+password login, user creation/deletion, group management (admin/user) |
| **Cognito Hosted UI** | Login web page provided by Cognito. Hosted at `cc-on-bedrock.auth.amazoncognito.com` |
| **ACM** (Certificate Manager) | SSL/TLS certificate management. `*.whchoi.net` wildcard certificate → provides HTTPS at CloudFront + ALB |
| **KMS** (Key Management Service) | Encryption key management. Used for EBS, Secrets Manager, and DynamoDB data encryption |
| **Secrets Manager** | Sensitive information store. Securely stores NextAuth Secret, CloudFront secret header values, etc. |
| **IAM Roles** | Defines AWS permissions for each service. ECS Task Role (Bedrock invocation), Dashboard EC2 Role (Cognito/ECS/DynamoDB management) |

---

<a id="en-usage-tracking"></a>
## Usage Tracking (Stack 03: Usage Tracking)

| Component | Role |
|-----------|------|
| **CloudTrail** | Records all AWS API calls. Detects Bedrock `InvokeModel` calls and generates events |
| **EventBridge** | Event router. Detects Bedrock API events from CloudTrail and triggers Lambda |
| **Lambda** (usage-tracker) | Records Bedrock API call information (user, model, tokens) to DynamoDB |
| **Lambda** (budget-check) | Runs every 5 minutes. Aggregates per-user costs → attaches IAM Deny Policy + SNS notification when budget is exceeded |
| **DynamoDB** | Usage data store. Structure: `PK: USER#{username}, SK: {date}#{model}`. Queried by Dashboard |
| **SNS** | Sends budget exceeded notifications (notifies administrators via email/SMS) |

---

<a id="en-devenv-container"></a>
## DevEnv Containers (Stack 04: ECS Dev Environment)

| Component | Role |
|-----------|------|
| **CloudFront** (DevEnv) | CDN + HTTPS termination. Forwards `*.dev.whchoi.net` requests to ALB. DDoS protection, global edge |
| **ALB** (DevEnv) | Load balancer. **Host-based routing** — `user01.dev.whchoi.net` → user01 container, `user02.dev.whchoi.net` → user02 container |
| **ECS Cluster** (EC2 mode) | Container orchestration. Docker container scheduling, placement, health checks |
| **EC2 Host** (m7g.4xlarge x8) | Physical instances where ECS containers actually run. ARM64 Graviton3, 16vCPU/64GiB |
| **Task Definition** (6 types) | Container spec definitions. `{OS} x {Tier}` = Ubuntu/AL2023 x Light/Standard/Power |
| **ECS Task** | Running container instance. One per user. code-server + Claude Code + Kiro |
| **EFS** (Elastic File System) | Shared file storage. Mounted at `/home/coder`. Work data persists across container restarts |
| **Security Groups** (3 types) | Network firewall. **Open** (allow all) / **Restricted** (limited) / **Locked** (VPC internal only) |

---

<a id="en-dashboard"></a>
## Dashboard (Stack 05: Dashboard)

| Component | Role |
|-----------|------|
| **CloudFront** (Dashboard) | CDN + HTTPS termination. `cconbedrock-dashboard.whchoi.net` → ALB. Blocks direct ALB access via X-Custom-Secret header |
| **ALB** (Dashboard) | Load balancer. Only accepts requests from CloudFront (Prefix List + Secret Header verification) |
| **EC2 ASG** (t4g.xlarge) | Dashboard server. Runs Next.js standalone app with PM2. Min:1 / Max:2 auto-scaling |
| **Next.js App** | 7-page web dashboard. Usage analytics, monitoring, user/container management, AI assistant |
| **S3** (Deploy Bucket) | Dashboard deployment artifact storage. `npm run build` → tar.gz → S3 upload → EC2 download |

---

<a id="en-ai-ml-services"></a>
## AI/ML Services

| Component | Role |
|-----------|------|
| **Amazon Bedrock** | AI model hosting. Provides Claude Opus 4.6 / Sonnet 4.6 models. ECS Task calls directly (Direct Mode) |
| **Bedrock VPC Endpoint** | Invokes Bedrock API from within the VPC. Traffic does not traverse the internet → security + low latency |
| **AgentCore Memory** | Stores AI Assistant conversation memory. Maintains previous conversation context for continuous consultation |

---

<a id="en-data-flow"></a>
## Data Flow Summary

### User Login

```
Browser → CloudFront → ALB → Next.js → Cognito OAuth → Authentication Complete
```

### Container Usage (Claude Code Development)

```
Browser → CloudFront → ALB (Host routing) → ECS Task (code-server)
Inside code-server: Claude Code → ECS Task Role → VPC Endpoint → Bedrock
```

### Usage Tracking

```
Bedrock API Call → CloudTrail → EventBridge → Lambda → DynamoDB
Dashboard → DynamoDB Query → Analytics Chart Display
```

### Budget Control

```
Lambda (every 5 min) → DynamoDB Scan → On exceed → IAM Deny Policy + SNS Notification
```

---

<a id="en-security-defense"></a>
## Multi-Layer Security Defense

```
Layer 1: CloudFront          (HTTPS termination, DDoS protection)
Layer 2: ALB                 (X-Custom-Secret header verification, Prefix List)
Layer 3: Cognito             (OAuth 2.0 user authentication)
Layer 4: Security Groups     (Network-level access control, 3-tier DLP)
Layer 5: DNS Firewall        (Domain-based filtering, threat lists)
Layer 6: IAM                 (Per-model Bedrock access control, per-user Task Role)
Layer 7: DLP                 (code-server file upload/download restriction, extension control)
```

---

<a id="en-task-definition"></a>
## Task Definition Specifications

| Task Definition | OS | vCPU | Memory | Use Case |
|----------------|-----|------|--------|----------|
| devenv-ubuntu-light | Ubuntu 24.04 | 1 | 4 GiB | Lightweight tasks, document editing |
| devenv-ubuntu-standard | Ubuntu 24.04 | 2 | 8 GiB | General development (default) |
| devenv-ubuntu-power | Ubuntu 24.04 | 4 | 12 GiB | Large builds, ML workloads |
| devenv-al2023-light | Amazon Linux 2023 | 1 | 4 GiB | AWS-native lightweight tasks |
| devenv-al2023-standard | Amazon Linux 2023 | 2 | 8 GiB | AWS-native general development |
| devenv-al2023-power | Amazon Linux 2023 | 4 | 12 GiB | AWS-native large workloads |

---

<a id="en-dashboard-pages"></a>
## Dashboard Page Structure

| Page | Access Level | Key Features |
|------|-------------|--------------|
| Home | All users | Cost/token/user/container summary, cluster metrics |
| AI Assistant | All users | Conversational AI based on Bedrock Converse API, AgentCore Memory |
| Analytics | All users | Per-model usage, per-department cost, daily trends, user leaderboard |
| Monitoring | admin | Container Insights (CPU/Memory/Network), ECS status |
| Security | admin | IAM policies, DLP status, DNS Firewall rules, security checklist |
| Users | admin | Cognito user CRUD, sorting/filtering, security policy assignment |
| Containers | admin | ECS container start/stop, sorting/filtering, duplicate prevention |
