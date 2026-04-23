#!/bin/bash
# Yocoolab Bridge: Inject Chrome element selections into Claude Code context
STATE_FILE="/tmp/yocoolab-bridge-last-seen.txt"
BRIDGE_URL="http://127.0.0.1:${YOCOOLAB_BRIDGE_PORT:-9800}/selections/latest"

RESPONSE=$(curl -s --connect-timeout 1 --max-time 2 "$BRIDGE_URL" 2>/dev/null)
if [ -z "$RESPONSE" ]; then
  exit 0
fi

CORRELATION_ID=$(echo "$RESPONSE" | jq -r '.selection.correlationId // empty' 2>/dev/null)
if [ -z "$CORRELATION_ID" ]; then
  exit 0
fi

LAST_SEEN=$(cat "$STATE_FILE" 2>/dev/null)
if [ "$CORRELATION_ID" = "$LAST_SEEN" ]; then
  exit 0
fi

echo "$CORRELATION_ID" > "$STATE_FILE"

TAG=$(echo "$RESPONSE" | jq -r '.selection.element.tag' 2>/dev/null)
TEXT=$(echo "$RESPONSE" | jq -r '.selection.element.text // ""' 2>/dev/null | head -c 100)
SELECTOR=$(echo "$RESPONSE" | jq -r '.selection.element.selector // ""' 2>/dev/null)
PAGE_URL=$(echo "$RESPONSE" | jq -r '.selection.page.url // ""' 2>/dev/null)
ATTRS=$(echo "$RESPONSE" | jq -c '.selection.element.attributes // {}' 2>/dev/null)

STYLES_TEXT=$(echo "$RESPONSE" | jq -r '
  .selection.element.styles.computed // {} |
  to_entries | map("\(.key): \(.value)") | join(", ")
' 2>/dev/null)

echo "[Yocoolab Bridge] Element selected in Chrome:"
echo "  Tag: <${TAG}>"
echo "  Text: \"${TEXT}\""
echo "  Selector: ${SELECTOR}"
echo "  Page: ${PAGE_URL}"
echo "  Attributes: ${ATTRS}"
[ -n "$STYLES_TEXT" ] && echo "  Styles: ${STYLES_TEXT}"
exit 0
