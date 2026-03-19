#!/bin/bash
# Monitors code-server idle status and writes metric for CloudWatch
# Auto-timeout handled by external Lambda that reads this metric

IDLE_THRESHOLD_SECONDS="${IDLE_TIMEOUT_SECONDS:-7200}"  # 2 hours default
METRIC_FILE="/tmp/idle-status"

while true; do
  sleep 60

  # Check code-server active connections
  ACTIVE_CONNECTIONS=$(curl -s http://localhost:8080/healthz 2>/dev/null | grep -c "alive" || echo "0")

  # Check recent terminal activity (pty writes in last 5 min)
  RECENT_ACTIVITY=$(find /home/coder -name "*.pty" -mmin -5 2>/dev/null | wc -l)

  # Check CPU usage of coder user processes
  CPU_USAGE=$(ps -u coder -o pcpu= 2>/dev/null | awk '{sum+=$1} END {printf "%.0f", sum}')

  if [ "${ACTIVE_CONNECTIONS:-0}" -eq 0 ] && [ "${RECENT_ACTIVITY:-0}" -eq 0 ] && [ "${CPU_USAGE:-0}" -lt 5 ]; then
    # Increment idle counter
    IDLE_COUNT=$(cat "$METRIC_FILE" 2>/dev/null || echo "0")
    IDLE_COUNT=$((IDLE_COUNT + 1))
    echo "$IDLE_COUNT" > "$METRIC_FILE"

    IDLE_MINUTES=$((IDLE_COUNT))
    echo "Container idle for ${IDLE_MINUTES} minutes (threshold: $((IDLE_THRESHOLD_SECONDS / 60)) min)"
  else
    echo "0" > "$METRIC_FILE"
  fi
done
