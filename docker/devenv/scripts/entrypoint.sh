#!/bin/bash
set -euo pipefail

echo "=== CC-on-Bedrock Devenv Container Starting ==="

USER_HOME="/home/coder"
SECURITY_POLICY="${SECURITY_POLICY:-open}"

# --- EFS directory setup ---
if [ -d "$USER_HOME/workspace" ]; then
  echo "EFS workspace already mounted"
else
  mkdir -p "$USER_HOME/workspace"
fi

# Ensure correct ownership
chown -R coder:coder "$USER_HOME"

# --- Ensure .bashrc.d directory exists ---
sudo -u coder mkdir -p "$USER_HOME/.bashrc.d"

# --- Configure Claude Code for Bedrock via LiteLLM ---
if [ -n "${ANTHROPIC_BASE_URL:-}" ]; then
  cat > "$USER_HOME/.bashrc.d/claude-env.sh" << ENVEOF
export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL}"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-northeast-2}"
export CLAUDE_CODE_USE_BEDROCK=1
ENVEOF
  chown coder:coder "$USER_HOME/.bashrc.d/claude-env.sh"
fi

# --- Configure Kiro for Bedrock ---
sudo -u coder mkdir -p "$USER_HOME/.kiro/settings"
cat > "$USER_HOME/.kiro/settings/bedrock.json" << KIROEOF
{
  "aws_region": "${AWS_DEFAULT_REGION:-ap-northeast-2}",
  "bearer_token": "${AWS_BEARER_TOKEN_BEDROCK:-}"
}
KIROEOF
chown coder:coder "$USER_HOME/.kiro/settings/bedrock.json"

# --- MCP Server Configuration ---
sudo -u coder mkdir -p "$USER_HOME/.claude"
cat > "$USER_HOME/.claude/mcp_servers.json" << MCPEOF
{
  "awslabs-core-mcp-server": {
    "command": "uvx",
    "args": ["awslabs.core-mcp-server@latest"],
    "env": {"AWS_REGION": "${AWS_DEFAULT_REGION:-ap-northeast-2}"}
  },
  "bedrock-agentcore-mcp-server": {
    "command": "uvx",
    "args": ["bedrock-agentcore-mcp-server@latest"],
    "env": {"AWS_REGION": "${AWS_DEFAULT_REGION:-ap-northeast-2}"}
  }
}
MCPEOF
chown coder:coder "$USER_HOME/.claude/mcp_servers.json"

# --- Security Policy: code-server flags ---
CODESERVER_FLAGS=""
case "$SECURITY_POLICY" in
  restricted)
    echo "Applying RESTRICTED security policy"
    CODESERVER_FLAGS="--disable-file-downloads --disable-file-uploads"
    # Use pre-approved extensions only
    if [ -d /opt/extensions-approved ]; then
      CODESERVER_FLAGS="$CODESERVER_FLAGS --extensions-dir /opt/extensions-approved"
    fi
    ;;
  locked)
    echo "Applying LOCKED security policy"
    CODESERVER_FLAGS="--disable-file-downloads --disable-file-uploads"
    # Read-only extensions
    if [ -d /opt/extensions-readonly ]; then
      CODESERVER_FLAGS="$CODESERVER_FLAGS --extensions-dir /opt/extensions-readonly"
    fi
    ;;
  *)
    echo "Applying OPEN security policy"
    ;;
esac

# --- Copy default VSCode settings if not exists ---
if [ ! -f "$USER_HOME/.local/share/code-server/User/settings.json" ]; then
  sudo -u coder mkdir -p "$USER_HOME/.local/share/code-server/User"
  cp /opt/devenv/config/settings.json "$USER_HOME/.local/share/code-server/User/settings.json"
  chown coder:coder "$USER_HOME/.local/share/code-server/User/settings.json"
fi

# --- Ensure .bashrc.d sourcing ---
sudo -u coder bash -c "
  mkdir -p $USER_HOME/.bashrc.d
  if ! grep -q 'bashrc.d' $USER_HOME/.bashrc 2>/dev/null; then
    echo 'for f in ~/.bashrc.d/*.sh; do [ -r \"\$f\" ] && source \"\$f\"; done' >> $USER_HOME/.bashrc
  fi
"

# --- Start idle monitor in background ---
/opt/devenv/scripts/idle-monitor.sh &

# --- Start code-server ---
echo "Starting code-server with flags: $CODESERVER_FLAGS"
exec sudo -u coder \
  PASSWORD="${CODESERVER_PASSWORD:-}" \
  code-server \
  --bind-addr 0.0.0.0:8080 \
  --auth "${CODESERVER_AUTH:-password}" \
  --user-data-dir "$USER_HOME/.local/share/code-server" \
  $CODESERVER_FLAGS \
  "$USER_HOME/workspace"
