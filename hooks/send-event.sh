#!/bin/bash
# send-event.sh - Forward Claude Code hook events to the unified Yocoolab MCP server
# Reads JSON from stdin, POSTs to the event collector endpoint.
# Always exits 0 to never interfere with Claude Code operation.

MONITOR_URL="${YOCOOLAB_MCP_URL:-http://127.0.0.1:9800/monitor/events}"

# Read all stdin into a variable
INPUT=$(cat)

# Fire and forget - async curl with 2s timeout
curl -s -X POST "$MONITOR_URL" \
  -H "Content-Type: application/json" \
  -d "$INPUT" \
  --connect-timeout 1 \
  --max-time 2 \
  >/dev/null 2>&1 &

exit 0
