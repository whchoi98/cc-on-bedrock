#!/bin/bash
# sync-mcp-config.sh — EC2 boot-time MCP configuration sync
# Queries DynamoDB for department gateway URLs, generates ~/.claude/mcp_servers.json
# Installed as systemd oneshot service (cc-mcp-sync.service)

set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-2}"
MCP_CONFIG_TABLE="${DEPT_MCP_CONFIG_TABLE:-cc-dept-mcp-config}"
LOG_PREFIX="[cc-mcp-sync]"

log() { echo "${LOG_PREFIX} $(date '+%Y-%m-%d %H:%M:%S') $*"; }

# Get IMDSv2 token
TOKEN=$(curl -sf -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 300" 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
  log "ERROR: Failed to get IMDSv2 token"
  exit 1
fi

METADATA_HEADER="X-aws-ec2-metadata-token: ${TOKEN}"

# Get instance tags via IMDS
INSTANCE_ID=$(curl -sf -H "$METADATA_HEADER" http://169.254.169.254/latest/meta-data/instance-id)
log "Instance: ${INSTANCE_ID}"

# Get department from instance tags
DEPARTMENT=$(aws ec2 describe-tags \
  --region "$REGION" \
  --filters "Name=resource-id,Values=${INSTANCE_ID}" "Name=key,Values=department" \
  --query 'Tags[0].Value' --output text 2>/dev/null || echo "default")

if [ "$DEPARTMENT" = "None" ] || [ -z "$DEPARTMENT" ]; then
  DEPARTMENT="default"
fi
log "Department: ${DEPARTMENT}"

# Get subdomain from instance tags
SUBDOMAIN=$(aws ec2 describe-tags \
  --region "$REGION" \
  --filters "Name=resource-id,Values=${INSTANCE_ID}" "Name=key,Values=subdomain" \
  --query 'Tags[0].Value' --output text 2>/dev/null || echo "unknown")
log "Subdomain: ${SUBDOMAIN}"

# Determine home directory for the user
USER_HOME="/home/${SUBDOMAIN}"
if [ ! -d "$USER_HOME" ]; then
  USER_HOME="/home/ubuntu"
fi
CLAUDE_DIR="${USER_HOME}/.claude"
MCP_CONFIG="${CLAUDE_DIR}/mcp_servers.json"

mkdir -p "$CLAUDE_DIR"

# Query DDB for common gateway
COMMON_GW_URL=""
COMMON_RESULT=$(aws dynamodb get-item \
  --region "$REGION" \
  --table-name "$MCP_CONFIG_TABLE" \
  --key '{"PK":{"S":"DEPT#COMMON"},"SK":{"S":"GATEWAY"}}' \
  --query 'Item' --output json 2>/dev/null || echo "{}")

if [ "$COMMON_RESULT" != "{}" ] && [ -n "$COMMON_RESULT" ]; then
  COMMON_GW_URL=$(echo "$COMMON_RESULT" | python3 -c "
import sys, json
item = json.load(sys.stdin)
print(item.get('gatewayUrl', {}).get('S', ''))" 2>/dev/null || true)
fi
log "Common Gateway: ${COMMON_GW_URL:-none}"

# Query DDB for department gateway
DEPT_GW_URL=""
if [ "$DEPARTMENT" != "default" ]; then
  DEPT_RESULT=$(aws dynamodb get-item \
    --region "$REGION" \
    --table-name "$MCP_CONFIG_TABLE" \
    --key "{\"PK\":{\"S\":\"DEPT#${DEPARTMENT}\"},\"SK\":{\"S\":\"GATEWAY\"}}" \
    --query 'Item' --output json 2>/dev/null || echo "{}")

  if [ "$DEPT_RESULT" != "{}" ] && [ -n "$DEPT_RESULT" ]; then
    DEPT_GW_URL=$(echo "$DEPT_RESULT" | python3 -c "
import sys, json
item = json.load(sys.stdin)
print(item.get('gatewayUrl', {}).get('S', ''))" 2>/dev/null || true)
  fi
fi
log "Dept Gateway: ${DEPT_GW_URL:-none}"

# Build mcp_servers.json
cat > "$MCP_CONFIG" << 'JSONEOF'
{
  "mcpServers": {
JSONEOF

FIRST=true

# Add common gateway if available
if [ -n "$COMMON_GW_URL" ]; then
  if [ "$FIRST" = true ]; then FIRST=false; else echo "," >> "$MCP_CONFIG"; fi
  cat >> "$MCP_CONFIG" << EOF
    "cc-common-mcp": {
      "type": "agentcore-gateway",
      "url": "${COMMON_GW_URL}",
      "auth": "sigv4",
      "region": "${REGION}"
    }
EOF
fi

# Add department gateway if available
if [ -n "$DEPT_GW_URL" ]; then
  if [ "$FIRST" = true ]; then FIRST=false; else echo "," >> "$MCP_CONFIG"; fi
  cat >> "$MCP_CONFIG" << EOF
    "cc-dept-mcp": {
      "type": "agentcore-gateway",
      "url": "${DEPT_GW_URL}",
      "auth": "sigv4",
      "region": "${REGION}"
    }
EOF
fi

cat >> "$MCP_CONFIG" << 'JSONEOF'
  }
}
JSONEOF

# Fix ownership
chown -R "${SUBDOMAIN}:${SUBDOMAIN}" "$CLAUDE_DIR" 2>/dev/null || true

log "MCP config written to ${MCP_CONFIG}"
log "Sync complete"
