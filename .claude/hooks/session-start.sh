#!/bin/bash
# SessionStart hook: load project context on conversation start

set -euo pipefail

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
LAST_COMMIT=$(git log -1 --oneline 2>/dev/null || echo "no commits")
DIRTY=$(git status --porcelain 2>/dev/null | wc -l)

echo "Branch: $BRANCH | Last: $LAST_COMMIT | Uncommitted: $DIRTY file(s)"
