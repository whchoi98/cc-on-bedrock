# Department Plugin Marketplace Management

## Overview

부서 단위 Claude Code Plugin Marketplace 관리 기능. 기존 MCP Gateway 관리(ADR-007)를 확장하여
Admin이 부서별로 허용하는 Plugin Marketplace URL을 관리하고, EC2 부팅 시 자동으로 등록한다.

## Goals

- Admin이 공통(전사) + 부서별 Plugin Marketplace를 관리
- EC2 부팅 시 `claude /plugin marketplace add <url>`로 자동 등록
- 유저가 직접 추가한 marketplace/plugin은 건드리지 않음 (자유도 유지)
- 기존 MCP Gateway 인프라와 일관된 2-Tier 패턴 (Common + Dept)

## Non-Goals

- Plugin 개별 설치/제거 관리 (marketplace 등록만, 개별 plugin 선택은 유저 자율)
- Plugin 실행 시간 제한이나 권한 관리
- AMI 프리베이크 (런타임 동기화만)
- 강제 동기화/플러그인 제거 (부팅 시 추가만)

## Architecture

```
Admin Dashboard                     EC2 DevEnv (per-user)
     │                                    │
     ▼                                    ▼
┌──────────────┐                  ┌─────────────────┐
│ /admin/mcp   │                  │ sync-mcp-config  │
│ Marketplaces │                  │ .sh (extended)   │
│ Tab (CRUD)   │                  │                  │
└──────┬───────┘                  └────────┬────────┘
       │ API                               │ Query
       ▼                                   ▼
┌──────────────────────────────────────────────┐
│           cc-dept-mcp-config (DynamoDB)       │
│                                               │
│  COMMON / MKTPLACE#official    → url, enabled │
│  DEPT#eng / MKTPLACE#omc      → url, enabled │
│  DEPT#ds / MKTPLACE#ds-tools  → url, enabled │
└──────────────────────────────────────────────┘
```

### Data Flow

1. **Admin** → Dashboard `/admin/mcp` Plugin Marketplaces 탭에서 marketplace URL 등록
2. **API** → `POST /api/admin/mcp/marketplaces` → DynamoDB `cc-dept-mcp-config` PutItem
3. **EC2 부팅** → `sync-mcp-config.sh` 실행
   - (기존) MCP Gateway URL 조회 → `mcp_servers.json` 생성
   - (신규) Marketplace URL 조회 → `claude /plugin marketplace add <url>` 실행
4. **유저** → marketplace에서 원하는 plugin을 `/plugin install` 명령으로 선택 설치

## DynamoDB Schema

기존 `cc-dept-mcp-config` 테이블에 `MKTPLACE#` SK 패턴 추가. 테이블 변경 불필요.

### Record Patterns

| PK | SK | Attributes |
|----|-----|------------|
| `COMMON` | `GATEWAY` | (기존) `gatewayId`, `gatewayUrl`, `status`, `lastSyncAt` |
| `COMMON` | `MCP#{catalogId}` | (기존) `targetId`, `enabled`, `addedAt` |
| `COMMON` | `MKTPLACE#{id}` | `name`, `url`, `description`, `enabled`, `addedBy`, `addedAt` |
| `DEPT#{dept}` | `GATEWAY` | (기존) gateway state |
| `DEPT#{dept}` | `MCP#{catalogId}` | (기존) MCP assignment |
| `DEPT#{dept}` | `MKTPLACE#{id}` | `name`, `url`, `description`, `enabled`, `addedBy`, `addedAt` |

### Marketplace Record Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | String | `COMMON` or `DEPT#{department}` |
| `SK` | String | `MKTPLACE#{marketplace-id}` |
| `name` | String | Display name (e.g., "claude-plugins-official") |
| `url` | String | GitHub repo URL (e.g., "https://github.com/anthropics/claude-plugins") |
| `description` | String | Short description |
| `enabled` | Boolean | Active flag |
| `addedBy` | String | Admin username who added |
| `addedAt` | String | ISO 8601 timestamp |

### Example Data

```json
{"PK": "COMMON", "SK": "MKTPLACE#official", "name": "claude-plugins-official", "url": "https://github.com/anthropics/claude-plugins", "enabled": true}
{"PK": "DEPT#engineering", "SK": "MKTPLACE#omc", "name": "oh-my-cloud-skills", "url": "https://github.com/user/oh-my-cloud-skills", "enabled": true}
{"PK": "DEPT#datascience", "SK": "MKTPLACE#ds-tools", "name": "ds-claude-plugins", "url": "https://github.com/org/ds-claude-plugins", "enabled": true}
```

## EC2 Boot Sync Script

`docker/devenv/scripts/sync-mcp-config.sh` 끝에 Plugin Marketplace 동기화 로직 추가.

### Sync Logic

```bash
# ─── Plugin Marketplace Sync ───
COMMON_MKT=$(aws dynamodb query \
  --table-name cc-dept-mcp-config \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"COMMON"},":sk":{"S":"MKTPLACE#"}}' \
  --projection-expression "url,enabled" \
  --region "$REGION" --output json 2>/dev/null)

DEPT_MKT=$(aws dynamodb query \
  --table-name cc-dept-mcp-config \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"DEPT#'"${DEPT}"'"},":sk":{"S":"MKTPLACE#"}}' \
  --projection-expression "url,enabled" \
  --region "$REGION" --output json 2>/dev/null)

# Parse and install enabled marketplaces
for URL in $(echo "$COMMON_MKT" "$DEPT_MKT" | jq -r '.Items[] | select(.enabled.BOOL==true) | .url.S' 2>/dev/null); do
  sudo -u coder claude /plugin marketplace add "$URL" 2>/dev/null && \
    log "Added marketplace: $URL" || \
    log "WARN: Failed to add marketplace: $URL"
done
```

### Key Properties

- **Idempotent**: `marketplace add`는 이미 등록된 URL을 skip
- **Non-destructive**: 유저가 직접 추가한 marketplace는 유지
- **Fail-safe**: marketplace 추가 실패해도 MCP 동기화에 영향 없음
- **Boot-time only**: 주기적 동기화 없음. 인스턴스 재시작 시 반영

## Admin UI

### Tab Addition

기존 `/admin/mcp` 페이지의 탭에 "Plugin Marketplaces" 추가:

```
[MCP Catalog] [Dept Assignments] [Gateway Status] [Plugin Marketplaces]
```

### Plugin Marketplaces Tab

- **Scope 선택**: Common / 부서별 드롭다운 (기존 Gateway 탭의 부서 선택과 동일 패턴)
- **Marketplace 카드 목록**: name, URL, description, enabled 상태, Edit/Remove 버튼
- **Add Marketplace 모달**: ID, Name, URL, Description 입력

### Add Marketplace Modal Fields

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Marketplace ID | text | Yes | `^[a-z0-9-]+$`, unique within scope |
| Name | text | Yes | Display name |
| URL | text | Yes | Valid GitHub URL (`https://github.com/...`) |
| Description | text | No | Short description |
| Scope | select | Yes | "Common" or specific department |

## API Route

### `GET /api/admin/mcp/marketplaces`

Query params: `scope` ("common" or department name)

Returns array of marketplace records for the given scope.

### `POST /api/admin/mcp/marketplaces`

Body:
```json
{
  "id": "omc",
  "name": "oh-my-cloud-skills",
  "url": "https://github.com/user/oh-my-cloud-skills",
  "description": "AWS operations & content plugins",
  "scope": "engineering"
}
```

Creates `PK=DEPT#engineering, SK=MKTPLACE#omc` record. If scope is "common", uses `PK=COMMON`.

### `PUT /api/admin/mcp/marketplaces`

Body: `{ "id": "omc", "scope": "engineering", "enabled": false }`

Updates marketplace record (toggle enabled, edit fields).

### `DELETE /api/admin/mcp/marketplaces`

Body: `{ "id": "omc", "scope": "engineering" }`

Deletes marketplace record.

## Department Dashboard

기존 `dept-dashboard.tsx`의 MCP Tools 카드에 Marketplaces 섹션 추가 (읽기 전용):

```
┌─ MCP & Plugins ──────────────────┐
│  Gateway: ● ACTIVE               │
│  MCP Tools: tool-a, tool-b       │
│                                   │
│  Plugin Marketplaces:             │
│  • claude-plugins-official (공통) │
│  • eng-internal-tools (부서)      │
└───────────────────────────────────┘
```

API: 기존 `/api/admin/mcp/marketplaces?scope={dept}` + `scope=common` 두 번 호출하여 머지.

## Files to Change

| File | Change | Notes |
|------|--------|-------|
| `docker/devenv/scripts/sync-mcp-config.sh` | Marketplace sync logic 추가 (~25줄) | AMI rebuild 필요 |
| `shared/nextjs-app/src/app/admin/mcp/mcp-management.tsx` | "Plugin Marketplaces" 탭 추가 | |
| `shared/nextjs-app/src/app/api/admin/mcp/marketplaces/route.ts` | 신규 CRUD API | |
| `shared/nextjs-app/src/app/dept/dept-dashboard.tsx` | Marketplaces 읽기 전용 표시 | |

### No Changes Required

- CDK stacks — 테이블 스키마 변경 없음
- `gateway-manager.py` — marketplace는 Gateway와 무관
- Systemd service — 기존 `cc-mcp-sync.service`가 sync-mcp-config.sh를 실행
- IAM — EC2 task role에 이미 `cc-dept-mcp-config` DDB read 권한 있음

## Security

- Admin 세션 필수 (기존 MCP API와 동일)
- URL 유효성 검증 (GitHub URL 패턴)
- EC2에서 DDB query 시 기존 task role의 DDB read 권한 사용 (추가 IAM 불필요)
- `claude /plugin marketplace add`는 coder 유저로 실행 (root 아님)

## Testing

1. DDB에 marketplace 레코드 수동 삽입 → EC2 reboot → `~/.claude/plugins/known_marketplaces.json` 확인
2. Admin UI에서 marketplace 추가/편집/삭제 → DDB 레코드 확인
3. Dept Dashboard에서 읽기 전용 표시 확인
4. 이미 등록된 marketplace URL 재등록 시 멱등성 확인
5. 잘못된 URL 등록 시 부팅 스크립트가 graceful 실패하는지 확인
