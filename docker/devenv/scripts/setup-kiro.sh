#!/bin/bash
set -euo pipefail

echo "=== Setting up Kiro CLI ==="

# TODO: Install Kiro CLI
# Kiro is an AWS product. Verify the correct package name at build time:
#   npm install -g @anthropic-ai/kiro   (or @aws/kiro-cli, or another name)
# Fallback: download binary from official release page
npm install -g kiro 2>/dev/null || {
  echo "WARN: Kiro CLI package name may have changed. Check https://kiro.dev for latest install instructions."
  echo "Continuing without Kiro CLI - install manually after container starts."
}

NPM_PREFIX="$(npm prefix -g 2>/dev/null)"
if [ -n "$NPM_PREFIX" ] && [ -f "$NPM_PREFIX/bin/kiro" ] && ! command -v kiro &>/dev/null; then
  ln -sf "$NPM_PREFIX/bin/kiro" /usr/local/bin/kiro
fi

# Kiro config directory
sudo -u coder mkdir -p /home/coder/.kiro/settings

echo "=== Kiro CLI setup complete ==="
