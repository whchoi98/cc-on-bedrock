# Department MCP via AgentCore Gateway — Design Spec

## 1. Overview

CC-on-Bedrock 멀티유저 환경에서 부서별로 격리된 MCP 도구를 AgentCore Gateway를 통해 제공하는 시스템 설계.

**핵심 구조**: Common Gateway (전사 모니터링) + Per-Department Gateway (부서 특화 도구)

## 2. Architecture

### 2-Tier Gateway

```
┌─────────────────────────────────────────────────────────┐
│ EC2 Instance (user-A, dept: data-engineering)           │
│                                                         │
│  Claude Code → mcp_servers.json                         │
│    ├─ cc-common-mcp → Common Gateway                    │
│    │   └─ ecs-mcp, cloudwatch-mcp, dynamodb-mcp        │
│    └─ cc-dept-mcp → Data-Engineering Gateway            │
│        └─ athena-mcp, s3-mcp                            │
└────────────────┬──────────────────┬─────────────────────┘
                 │ SigV4            │ SigV4
         ┌───────▼───────┐  ┌──────▼──────────┐
         │ Common GW     │  │ Dept GW          │
         │ (all users)   │  │ (dept only)      │
         └───────┬───────┘  └──────┬──────────┘
                 │                  │
         ┌───────▼──────────────────▼──────────┐
         │        MCP Lambda Targets           │
         │  (shared across gateways)           │
         └─────────────────────────────────────┘
```

### Data Flow

```
Admin Dashboard → /api/admin/mcp/assignments (PUT)
  → DynamoDB cc-dept-mcp-config (PK=DEPT#data, SK=MCP#athena-mcp)
  → DDB Streams
  → gateway-manager Lambda
  → AgentCore API: create_gateway_target()
  → Gateway에 Lambda target 등록
```

## 3. Data Model

### cc-mcp-catalog (MCP 도구 카탈로그)

| PK | SK | Attributes |
|----|----|-----------|
| `MCP#ecs-mcp` | `META` | name, description, category=common, lambdaArn, tools[], enabled |
| `MCP#athena-mcp` | `META` | name, description, category=department, lambdaArn, tools[], enabled |

### cc-dept-mcp-config (부서 Gateway + MCP 할당)

| PK | SK | Attributes |
|----|----|-----------|
| `DEPT#COMMON` | `GATEWAY` | status, gatewayId, gatewayUrl, roleArn, createdAt |
| `DEPT#COMMON` | `MCP#ecs-mcp` | enabled, assignedAt, assignedBy |
| `DEPT#data` | `GATEWAY` | status=ACTIVE, gatewayId, gatewayUrl, roleArn |
| `DEPT#data` | `MCP#athena-mcp` | enabled=true, assignedAt, assignedBy |

## 4. Gateway Manager Lambda

**File**: `cdk/lib/lambda/gateway-manager.py`
**Trigger**: DynamoDB Streams (cc-dept-mcp-config) + Direct invocation
**DLQ**: SQS queue for failed stream events

### Actions

| Trigger | Action |
|---------|--------|
| GATEWAY INSERT (status=CREATING) | Create IAM role → Create AgentCore Gateway → Register assigned MCP targets |
| MCP# INSERT/MODIFY (enabled=true) | Register Lambda target on dept gateway |
| MCP# REMOVE or enabled=false | Remove Lambda target from dept gateway |
| GATEWAY REMOVE | Remove all targets → Delete gateway → Delete IAM role |
| Direct: `sync_gateway` | Re-register all assigned MCP targets |

### IAM Role per Gateway

```
Role: cc-on-bedrock-agentcore-gateway-{dept}
Trust: bedrock-agentcore.amazonaws.com
Policy: lambda:InvokeFunction on arn:aws:lambda:{region}:{account}:function:cconbedrock-*-mcp
```

## 5. Admin Dashboard

### Pages

| Path | Component | Description |
|------|-----------|-------------|
| `/admin/mcp` | `page.tsx` + `mcp-management.tsx` | 3-tab UI |

### Tabs

1. **MCP Catalog**: Card grid of all catalog items (name, description, category badge, tool tags)
2. **Department Assignments**: Department selector + checkbox list for MCP assignment/removal
3. **Gateway Status**: Table with department, status badge, gateway ID, created/synced dates, sync/delete actions

### API Routes

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/admin/mcp/catalog` | GET, POST, PUT | MCP catalog CRUD |
| `/api/admin/mcp/assignments` | GET, PUT | Department MCP assignments |
| `/api/admin/mcp/gateways` | GET, POST, DELETE | Gateway lifecycle |
| `/api/admin/mcp/gateways/sync` | POST | Trigger gateway re-sync |

## 6. EC2 MCP Injection

### Boot-Time Sync

**Script**: `docker/devenv/scripts/sync-mcp-config.sh`
**Service**: `docker/devenv/systemd/cc-mcp-sync.service` (oneshot, After=network-online)

Flow:
1. Get instance tags via IMDSv2 (department, subdomain)
2. Query DDB for `DEPT#COMMON/GATEWAY` → common gateway URL
3. Query DDB for `DEPT#{dept}/GATEWAY` → department gateway URL
4. Generate `~/.claude/mcp_servers.json` with gateway entries
5. Fix ownership (chown to user)

**Stop/Start 내구성**: systemd oneshot runs on every boot → always gets latest config

### Per-User IAM Policy

`ec2-clients.ts` `applyGatewayPolicy()` — called during instance profile setup:
1. Query DDB for COMMON and dept gateway IDs
2. Construct InvokeGateway policy for both gateways
3. Apply as inline policy on `cc-on-bedrock-task-{subdomain}` role

## 7. Security Model

### 3-Layer IAM Isolation

```
Layer 1: Per-User Role
  cc-on-bedrock-task-{subdomain}
  └─ InvokeGateway: only COMMON + own dept gateway

Layer 2: Gateway Role  
  cc-on-bedrock-agentcore-gateway-{dept}
  └─ InvokeFunction: only cconbedrock-*-mcp lambdas

Layer 3: Lambda Execution Role
  cc-on-bedrock-agentcore-lambda
  └─ Actual AWS API permissions (ECS, CloudWatch, DynamoDB, etc.)
```

### Permission Boundary

`cc-on-bedrock-task-boundary` (in 02-security-stack.ts):
- Added: `bedrock-agentcore:InvokeGateway` on `gateway/*`
- Added: `dynamodb:GetItem,Query` on `cc-dept-mcp-config`

## 8. CDK Changes

### 03-usage-tracking-stack.ts

- `cc-mcp-catalog` DDB table (PK/SK, PAY_PER_REQUEST, KMS encrypted)
- `cc-dept-mcp-config` DDB table (PK/SK, Streams NEW_AND_OLD_IMAGES)
- `cc-on-bedrock-gateway-manager` Lambda (Python 3.12, 5min timeout)
- DDB Streams event source → Lambda (batchSize=10, retryAttempts=3, SQS DLQ)
- IAM: AgentCore gateway management + IAM role management + Lambda invoke

### 02-security-stack.ts

- Permission Boundary: 2 new statements (AgentCoreGateway, DynamoDbMcpConfig)

### 05-dashboard-stack.ts

- Dashboard role: read access to cc-mcp-catalog and cc-dept-mcp-config

## 9. Department Manager View

`dept-dashboard.tsx` — Added MCP Gateway status card:
- Gateway status badge (ACTIVE/CREATING/ERROR)
- Assigned MCP tags
- Last sync timestamp

`/api/dept` route — Added `mcpInfo` to response:
- Queries `cc-dept-mcp-config` for gateway status and assigned MCPs

## 10. Initial MCP Catalog

| MCP ID | Name | Category | Tools |
|--------|------|----------|-------|
| ecs-mcp | ECS Container MCP | common | list_tasks, describe_task, get_cluster_info |
| cloudwatch-mcp | CloudWatch Metrics MCP | common | get_metrics, query_logs, get_alarms |
| dynamodb-mcp | DynamoDB MCP | common | query_usage, get_budget, check_health |
| github-mcp | GitHub MCP | department | list_repos, create_pr, review_pr, manage_issues |
| jira-mcp | Jira MCP | department | search_issues, create_issue, update_sprint |
| athena-mcp | Athena Query MCP | department | run_query, list_databases, get_query_results |
| s3-mcp | S3 Data MCP | department | list_objects, get_object, generate_presigned_url |
| slack-mcp | Slack MCP | department | send_message, list_channels, search_messages |

Seeding: `python3 scripts/seed-mcp-catalog.py`

## 11. Verification Plan

1. **Unit**: Gateway Manager Lambda — mock DDB Streams events, verify AgentCore API calls
2. **Integration**: Create dept → Assign MCP → Start EC2 → Verify `mcp_servers.json`
3. **Security**: Cross-department access prevention (user-A from dept-X cannot invoke dept-Y gateway)
4. **Stop/Start**: Stop EC2 → Modify MCP assignment → Start EC2 → Verify updated config
5. **Failure**: DLQ handling — simulate Lambda failure, verify SQS DLQ receipt

## 12. Implementation Priority

| Phase | Scope | Dependencies |
|-------|-------|-------------|
| 1 | Data Layer (DDB tables, CDK) | None |
| 2 | Gateway Manager Lambda | Phase 1 |
| 3 | Admin Dashboard (UI + API) | Phase 1 |
| 4 | EC2 MCP Injection | Phase 1, 2 |
| 5 | Department Manager View | Phase 1 |
| 6 | Verification & Testing | All phases |
