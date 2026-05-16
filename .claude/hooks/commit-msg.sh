#!/bin/bash
# Git commit-msg hook: enforce conventional commits
# Types: feat, fix, docs, test, chore, refactor, perf, ci, style, build

COMMIT_MSG_FILE="$1"
COMMIT_MSG=$(head -1 "$COMMIT_MSG_FILE")

PATTERN='^(feat|fix|docs|test|chore|refactor|perf|ci|style|build)(\(.+\))?!?: .+'

if ! echo "$COMMIT_MSG" | grep -qE "$PATTERN"; then
  echo "ERROR: Commit message must follow conventional commits format."
  echo "  Format: <type>(<scope>): <description>"
  echo "  Types: feat, fix, docs, test, chore, refactor, perf, ci, style, build"
  echo "  Example: feat(auth): add SSO login support"
  echo ""
  echo "  Your message: $COMMIT_MSG"
  exit 1
fi
