#!/bin/bash
# Yocoolab Bridge: Auto-start bridge server and report status
BRIDGE_URL="http://127.0.0.1:${YOCOOLAB_BRIDGE_PORT:-9800}/health"

RESPONSE=$(curl -s --connect-timeout 1 --max-time 2 "$BRIDGE_URL" 2>/dev/null)
if [ -z "$RESPONSE" ]; then
  # Bridge not running — MCP server will start it automatically
  echo "[Yocoolab Bridge] Bridge not detected. It will start when the MCP server initializes."
  exit 0
fi

COUNT=$(echo "$RESPONSE" | jq -r '.selections // 0' 2>/dev/null)
echo "[Yocoolab Bridge] CONNECTED - Bridge is running. ${COUNT} selections in buffer."
exit 0
