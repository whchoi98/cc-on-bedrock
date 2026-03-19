#!/bin/bash
set -euo pipefail

echo "=== Shell Script Lint Tests ==="
FAIL=0

# Install shellcheck if not present
command -v shellcheck &>/dev/null || {
  echo "Installing shellcheck..."
  apt-get update -qq && apt-get install -y shellcheck 2>/dev/null || \
    dnf install -y shellcheck 2>/dev/null || \
    echo "WARN: shellcheck not available, skipping lint"
  }

if command -v shellcheck &>/dev/null; then
  for script in docker/devenv/scripts/*.sh docker/litellm/scripts/*.sh scripts/*.sh docker/build.sh; do
    [ -f "$script" ] || continue
    echo "Checking $script..."
    if shellcheck -S warning "$script"; then
      echo "  PASS"
    else
      echo "  FAIL"
      FAIL=1
    fi
  done
else
  echo "SKIP: shellcheck not installed"
fi

echo "=== Lint tests complete (failures: $FAIL) ==="
exit $FAIL
