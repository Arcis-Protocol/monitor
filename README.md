# @arcisprotocol/monitor

On-chain monitoring for Arcis Protocol — watches events, runs health checks, sends Telegram alerts.

## What It Watches

**Events (real-time):**
- Deposits and withdrawals with amount and agent address
- Large transactions flagged (configurable threshold)
- Strategy harvest events

**Health checks (periodic):**
- TVL drop detection (alerts on >20% drop)
- TVL invariant: `totalAssets ≈ reserve + deployed` (alerts on >1% drift)
- Vault pause state
- Credit utilization (alerts above 80%)
- RPC connectivity

## Setup

```bash
git clone https://github.com/Arcis-Protocol/monitor.git
cd monitor && npm install
```

### Environment Variables

```bash
TELEGRAM_BOT_TOKEN=your_bot_token    # From @BotFather
TELEGRAM_CHAT_ID=your_chat_id        # Your TG group ID
ALERT_THRESHOLD=10000                 # Large tx threshold in USDC (default: 10K)
```

### Run

```bash
npx tsx src/index.ts
```

### Without Telegram (logging only)

Just run without the env vars — all alerts print to stdout.

## Alert Levels

| Level | Meaning |
|---|---|
| 🟢 | Info (monitor started, periodic status) |
| 🟡 | Warning (large deposit, high utilization, TVL drift) |
| 🔴 | Critical (large withdrawal, vault paused, TVL crash, health check failure) |

## Deploy

Run as a background process, systemd service, or deploy to Railway/Render:

```bash
npm run build
node dist/index.js
```

---

*ARCIS · Of the Citadel · MMXXVI*
