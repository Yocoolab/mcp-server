#!/bin/bash
# Check for pending companion messages and inject them into Claude Code's context
# This runs on every UserPromptSubmit — if messages exist, they appear in the conversation

BRIDGE_URL="${YOCOOLAB_MCP_URL:-http://127.0.0.1:9800}"

response=$(curl -s --connect-timeout 1 --max-time 2 "$BRIDGE_URL/companion/peek" 2>/dev/null)

if [ -z "$response" ]; then
  exit 0
fi

# Check if there are messages
count=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('messages',[])))" 2>/dev/null)

if [ "$count" = "0" ] || [ -z "$count" ]; then
  exit 0
fi

# Format messages for Claude Code context
echo "$response" | python3 -c "
import sys, json
d = json.load(sys.stdin)
msgs = d.get('messages', [])
if not msgs:
    sys.exit(0)
print()
print('=== COMPANION PANEL MESSAGES ===')
print(f'{len(msgs)} new message(s) from the Chrome extension companion panel.')
print('Reply to each using mcp__yocoolab__reply_to_companion(message=\"...\").')
print()
for m in msgs:
    print(f'[{m[\"id\"]}] {m[\"content\"]}')
    pc = m.get('pageContext', {})
    if pc and pc.get('url'):
        print(f'    Page: {pc[\"url\"]}')
    ec = m.get('elementContext', {})
    if ec and ec.get('selector'):
        print(f'    Element: {ec[\"selector\"]}')
    print()
print('=== END COMPANION MESSAGES ===')
" 2>/dev/null

exit 0
