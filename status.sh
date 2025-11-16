#!/bin/bash

# MIDNIGHT MINING STATUS DASHBOARD
# Quick overview of what's running and mining stats

echo -e "\n🌙 \033[1;35mMIDNIGHT SCAVENGER MINE - STATUS DASHBOARD\033[0m\n"

# ============================================
# 1. RUNNING MINERS
# ============================================
echo -e "\033[1;36m📊 RUNNING MINERS:\033[0m"
MINERS=$(ps aux | grep -E "node.*(beast-miner|parallel-miner|recover-missed)" | grep -v grep)
if [ -z "$MINERS" ]; then
    echo "   No miners currently running"
else
    echo "$MINERS" | awk '{printf "   ✓ %-25s PID: %-7s CPU: %5s%%  MEM: %5s%%  Runtime: %s\n", $11, $2, $3, $4, $10}'
fi

# Count hash-server instances
HASH_SERVERS=$(ps aux | grep "hash-server" | grep -v grep | wc -l)
if [ $HASH_SERVERS -gt 0 ]; then
    echo -e "   \033[0;32m✓ $HASH_SERVERS hash-server instances running\033[0m"
fi

echo ""

# ============================================
# 2. CURRENT CHALLENGE
# ============================================
echo -e "\033[1;36m🎯 CURRENT CHALLENGE:\033[0m"
CHALLENGE=$(curl -s "https://scavenger.prod.gd.midnighttge.io/challenge" 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "$CHALLENGE" | jq -r '
        if .code == "active" then
            "   Challenge:  \(.challenge.challenge_id) (\(.challenge.challenge_number)/\(.total_challenges))",
            "   Day:        \(.challenge.day)/\(.max_day)",
            "   Difficulty: \(.challenge.difficulty)",
            "   Deadline:   \(.challenge.latest_submission)"
        else
            "   Status: \(.code)"
        end
    ' 2>/dev/null || echo "   Unable to parse challenge data"
else
    echo "   ⚠ Unable to fetch challenge (offline?)"
fi

echo ""

# ============================================
# 3. RECEIPTS DATABASE STATS
# ============================================
echo -e "\033[1;36m💾 RECEIPTS DATABASE:\033[0m"
if [ -f receipts-db.json ]; then
    TOTAL_ADDRS=$(jq 'keys | length' receipts-db.json)
    TOTAL_SOLUTIONS=$(jq '[.[] | keys | length] | add' receipts-db.json)
    echo "   Total addresses tracked: $TOTAL_ADDRS"
    echo "   Total solutions saved:   $TOTAL_SOLUTIONS"

    # Top 3 addresses by solution count
    echo "   Top miners:"
    jq -r 'to_entries | map({addr: .key[0:20], count: (.value | keys | length)}) | sort_by(.count) | reverse | .[:3] | .[] | "      \(.addr)... : \(.count) solutions"' receipts-db.json
else
    echo "   ⚠ No receipts-db.json found yet"
fi

echo ""

# ============================================
# 4. RECENT MINING ACTIVITY
# ============================================
echo -e "\033[1;36m⚡ RECENT ACTIVITY (last 10 lines):\033[0m"

# Check which log to tail (beast-miner takes priority, then parallel-miner, then recover)
if pgrep -f "beast-miner.js" > /dev/null; then
    LOG_FILE="logs/beast-miner.log"
    MINER_TYPE="beast-miner"
elif pgrep -f "parallel-miner.js" > /dev/null; then
    LOG_FILE="logs/parallel-miner.log"
    MINER_TYPE="parallel-miner"
elif pgrep -f "recover-missed-submissions.js" > /dev/null; then
    # Recover script outputs to stdout, not a log file
    echo "   (recover-missed-submissions running - check terminal output)"
    LOG_FILE=""
else
    echo "   No active miners"
    LOG_FILE=""
fi

if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
    echo "   From: $LOG_FILE"
    tail -10 "$LOG_FILE" | sed 's/^/   /'
fi

echo ""

# ============================================
# 5. HASH RATE ESTIMATE (from recent logs)
# ============================================
echo -e "\033[1;36m🔥 HASH RATE ESTIMATE:\033[0m"
if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
    # Look for recent "solved in X.XXs" entries and calculate hash rate
    RECENT_SOLVES=$(tail -100 "$LOG_FILE" | grep "solved in" | tail -5)
    if [ -n "$RECENT_SOLVES" ]; then
        echo "   Last 5 solutions:"
        echo "$RECENT_SOLVES" | sed 's/^/   /'
    else
        echo "   (No recent solutions in log)"
    fi
else
    echo "   (No active log file)"
fi

echo ""

# ============================================
# 6. SYSTEM RESOURCES
# ============================================
echo -e "\033[1;36m💻 SYSTEM RESOURCES:\033[0m"
CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
MEM_USAGE=$(free | grep Mem | awk '{printf "%.1f", $3/$2 * 100.0}')
echo "   CPU Usage: ${CPU_USAGE}%"
echo "   RAM Usage: ${MEM_USAGE}%"

echo ""
echo -e "\033[0;90m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
echo -e "\033[0;90mTip: Run './status.sh' anytime to refresh this dashboard\033[0m"
echo ""
