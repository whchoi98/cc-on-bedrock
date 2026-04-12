# ADR-007: 부서별 MCP — AgentCore Gateway 2-Tier 아키텍처

## Status: Accepted

## Date: 2026-04-12

## Context

CC-on-Bedrock은 멀티유저 Claude Code 개발환경에서 Bedrock AgentCore MCP Gateway를 통해 MCP(Model Context Protocol) 도구를 제공한다. 현재 상태:

1. **단일 Gateway**: 전사 공통 Gateway 1개 (ECS/CloudWatch/DynamoDB MCP)만 존재
2. **부서별 도구 분리 불가**: 데이터팀은 Athena MCP, 프론트엔드팀은 Figma MCP 등 부서 특화 도구가 필요하지만, 모든 사용자가 동일한 MCP 세트를 공유
3. **보안 격리 미흡**: A부서 사용자가 B부서 전용 데이터 접근 도구를 사용할 수 있는 구조
4. **수동 관리**: Gateway에 새 MCP 추가/제거 시 수동 CLI 작업 필요

## Options Considered

### Option A: Single Gateway + Tool-level ACL
- 단일 Gateway에 모든 MCP를 등록하고, tool 호출 시 사용자 부서를 확인하여 ACL 적용
- 장점: 구현 단순, Gateway 1개만 관리
- 단점: Lambda 내부에서 인가 로직 필요, 모든 도구가 모든 사용자에게 노출(discovery 격리 불가)

### Option B: Per-Department Gateway (Lambda-Managed, Event-Driven) ← **Selected**
- 전사 Common Gateway + 부서별 전용 Gateway (2-tier)
- Admin 대시보드에서 카탈로그 기반 MCP 할당
- DynamoDB Streams → Lambda로 Gateway 생명주기 자동 관리
- EC2 부팅 시 systemd oneshot 서비스가 DDB에서 gateway URL 동기화

### Option C: Kubernetes Sidecar Pattern
- 각 사용자 Pod에 MCP proxy sidecar 배치
- 장점: 완전한 네트워크 격리
- 단점: EC2-per-user 아키텍처와 맞지 않음, 복잡도 과다

## Decision

**Option B: Per-Department Gateway (Lambda-Managed, Event-Driven)** 선택

### 핵심 설계

1. **2-Tier Gateway**: Common Gateway (모니터링 MCP) + Per-Dept Gateway (부서 특화 MCP)
2. **카탈로그 기반 관리**: Admin이 MCP 카탈로그에서 부서에 MCP 할당 → DDB Streams → Lambda가 Gateway에 target 자동 등록
3. **3-Layer IAM 격리**:
   - Gateway Role: `cc-on-bedrock-agentcore-gateway-{dept}` — Lambda invoke 권한만
   - Lambda Role: 기존 `cc-on-bedrock-agentcore-lambda` — 실제 AWS API 접근
   - Per-User Inline Policy: `cc-on-bedrock-task-{subdomain}` role에 InvokeGateway 권한 동적 추가
4. **EC2 Config Sync**: systemd oneshot (`cc-mcp-sync.service`)로 부팅 시 DDB 조회 → `~/.claude/mcp_servers.json` 생성

### 데이터 모델

| 테이블 | PK | SK | 용도 |
|--------|----|----|------|
| `cc-mcp-catalog` | `MCP#{mcpId}` | `META` | MCP 도구 카탈로그 (이름, 설명, Lambda ARN, 도구 목록) |
| `cc-dept-mcp-config` | `DEPT#{dept}` | `GATEWAY` | 부서 Gateway 상태 (ID, URL, status, roleArn) |
| `cc-dept-mcp-config` | `DEPT#{dept}` | `MCP#{mcpId}` | 부서 MCP 할당 (enabled, assignedAt, assignedBy) |

### CDK 변경

- `03-usage-tracking-stack.ts`: 2 DDB 테이블 + Gateway Manager Lambda + DDB Streams trigger + SQS DLQ
- `02-security-stack.ts`: Permission Boundary에 `bedrock-agentcore:InvokeGateway` + `dynamodb:GetItem/Query` on mcp-config 추가
- `05-dashboard-stack.ts`: Dashboard role에 새 테이블 접근 권한 추가

## Consequences

### Positive
- **부서별 도구 격리**: 부서 Gateway에 할당된 MCP만 해당 부서 사용자에게 노출
- **자동화**: DDB Streams → Lambda로 Gateway 생명주기 완전 자동화 (관리자 CLI 불필요)
- **EC2 Stop/Start 내구성**: systemd oneshot으로 매 부팅 시 최신 config 동기화
- **확장성**: 새 MCP 추가 시 카탈로그에 등록 → 부서 할당만으로 배포 완료

### Negative
- **Gateway 수 증가**: 부서 수 × 1 Gateway — 비용과 관리 복잡도 증가 (but 부서 수는 보통 10~20개 수준)
- **전파 지연**: DDB Streams → Lambda → AgentCore API 경로에 수초~수십초 지연
- **IAM Role 증식**: 부서당 Gateway role 1개 추가 생성

### Risks
- AgentCore Gateway API가 아직 진화 중 — SDK 변경 시 Lambda 수정 필요
- DDB Streams retry 실패 시 SQS DLQ로 이동 — 수동 재처리 필요 (SNS 알림으로 감지)

## References
- Design Spec: `docs/superpowers/specs/2026-04-10-dept-mcp-agentcore-gateway-design.md`
- Existing Gateway: `agent/lambda/create_targets.py`
- AgentCore Gateway API: `bedrock-agentcore-control` boto3 client
- ADR-004: EC2-per-user architecture
- ADR-006: Department budget management
