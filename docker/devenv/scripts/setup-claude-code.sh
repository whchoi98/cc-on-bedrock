#!/bin/bash
set -euo pipefail

echo "=== Setting up Claude Code ==="

# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code
NPM_PREFIX="$(npm prefix -g 2>/dev/null)"
if [ -n "$NPM_PREFIX" ] && [ -f "$NPM_PREFIX/bin/claude" ] && ! command -v claude &>/dev/null; then
  ln -sf "$NPM_PREFIX/bin/claude" /usr/local/bin/claude
fi
echo "Claude Code CLI $(claude --version 2>/dev/null || echo 'installed')"

# Install Claude Code VSCode extension
# Try marketplace first, fallback to Open VSX
sudo -u coder code-server --install-extension Anthropic.claude-code 2>/dev/null || {
  echo "Marketplace install failed, trying Open VSX..."
  VSIX_URL=$(curl -s "https://open-vsx.org/api/Anthropic/claude-code/latest" | jq -r '.files.download // empty')
  if [ -n "$VSIX_URL" ]; then
    curl -fsSL "$VSIX_URL" -o /tmp/claude-code.vsix
    sudo -u coder code-server --install-extension /tmp/claude-code.vsix
    rm -f /tmp/claude-code.vsix
  else
    echo "WARN: Claude Code extension not available, skipping"
  fi
}

# TODO: Claude Code plugin installation
# The plugin installation mechanism may vary by Claude Code version.
# Verify the correct CLI commands at build time:
#   claude plugins add <plugin-name>   (if supported)
#   claude mcp add <server-name>       (for MCP servers)
# Plugins and MCP servers are configured at runtime via entrypoint.sh
# because they need environment-specific endpoints (Bedrock region, etc.)

# uvx is bundled with uv (installed in setup-common.sh), no separate install needed
# Verify uvx is available
command -v uvx &>/dev/null || echo "WARN: uvx not found, MCP servers may not work"

echo "=== Claude Code setup complete ==="
