import { createPublicClient, http, defineChain, formatUnits, parseAbiItem, type Address, type Log } from "viem";

// ── Config ──
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const ALERT_THRESHOLD_USDC = BigInt(process.env.ALERT_THRESHOLD || "10000") * 1_000_000n; // 10K USDC default
const HEALTH_CHECK_INTERVAL = 60_000; // 1 minute
const UTILIZATION_WARNING = 80; // Warn at 80% credit utilization

// ── Chain ──
const baseSepolia = defineChain({
  id: 84532, name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://base-sepolia.blockscout.com" } },
});

// ── Addresses ──
const VAULT = "0xa8eF658E125C7f6D7aFa9B6b8035b66b32CBE98d" as Address;
const CREDIT = "0x019540E33a0292a9DDE36bD9Ef11774d5A1Ce6FC" as Address;
const EXPLORER = "https://base-sepolia.blockscout.com";

// ── ABI Events ──
const VAULT_EVENTS = [
  parseAbiItem("event Deposit(address indexed sender, uint256 assets, uint256 shares)"),
  parseAbiItem("event Withdraw(address indexed sender, uint256 assets, uint256 shares)"),
  parseAbiItem("event StrategyHarvest(uint256 yield, uint256 fee)"),
  parseAbiItem("event Paused(address account)"),
  parseAbiItem("event Unpaused(address account)"),
];

// ── Read ABIs ──
const VAULT_ABI = [
  { name: "totalAssets", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "reserveBalance", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "deployedBalance", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "paused", type: "function", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
] as const;

const CREDIT_ABI = [
  { name: "lendingPool", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "totalBorrowed", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

// ── Client ──
const client = createPublicClient({ chain: baseSepolia, transport: http() });
const fmtUSDC = (v: bigint) => "$" + Number(formatUnits(v, 6)).toLocaleString("en-US", { minimumFractionDigits: 2 });
const fmtAddr = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);

// ── State ──
let lastTVL = 0n;
let lastUtilization = 0;
let alertCount = 0;

// ═══════════════════════════════════════════════════
//  TELEGRAM ALERTS
// ═══════════════════════════════════════════════════

async function sendAlert(message: string, level: "🟢" | "🟡" | "🔴" = "🟡") {
  const text = `${level} *ARCIS MONITOR*\n\n${message}\n\n_${new Date().toISOString()}_`;
  console.log(`[ALERT ${level}] ${message}`);
  alertCount++;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("  (Telegram not configured — alert logged only)");
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
  } catch (e: any) {
    console.error("  Telegram send failed:", e.message);
  }
}

// ═══════════════════════════════════════════════════
//  EVENT WATCHERS
// ═══════════════════════════════════════════════════

function startEventWatchers() {
  console.log("Starting event watchers...");

  // Watch Deposits
  client.watchContractEvent({
    address: VAULT,
    abi: [{ type: "event", name: "Deposit", inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ] }],
    eventName: "Deposit",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = log.args as any;
        const amount = args.assets || 0n;
        const msg = `📥 *Deposit*\nAgent: \`${fmtAddr(args.sender || "")}\`\nAmount: ${fmtUSDC(amount)}\n[TX](${EXPLORER}/tx/${log.transactionHash})`;

        if (amount >= ALERT_THRESHOLD_USDC) {
          sendAlert(msg + "\n\n⚠️ *Large deposit*", "🟡");
        } else {
          console.log(`[EVENT] Deposit: ${fmtUSDC(amount)} from ${fmtAddr(args.sender || "")}`);
        }
      }
    },
  });

  // Watch Withdrawals
  client.watchContractEvent({
    address: VAULT,
    abi: [{ type: "event", name: "Withdraw", inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ] }],
    eventName: "Withdraw",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = log.args as any;
        const amount = args.assets || 0n;
        const msg = `📤 *Withdrawal*\nAgent: \`${fmtAddr(args.sender || "")}\`\nAmount: ${fmtUSDC(amount)}\n[TX](${EXPLORER}/tx/${log.transactionHash})`;

        if (amount >= ALERT_THRESHOLD_USDC) {
          sendAlert(msg + "\n\n🔴 *Large withdrawal*", "🔴");
        } else {
          console.log(`[EVENT] Withdraw: ${fmtUSDC(amount)} from ${fmtAddr(args.sender || "")}`);
        }
      }
    },
  });

  console.log("  ✓ Deposit watcher active");
  console.log("  ✓ Withdrawal watcher active");
}

// ═══════════════════════════════════════════════════
//  HEALTH CHECKS
// ═══════════════════════════════════════════════════

async function runHealthCheck() {
  try {
    const [totalAssets, reserve, deployed, paused] = await Promise.all([
      client.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "totalAssets" }),
      client.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "reserveBalance" }),
      client.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "deployedBalance" }),
      client.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "paused" }),
    ]);

    // Check: vault paused
    if (paused) {
      await sendAlert("⏸ Vault is *PAUSED*\nAll deposits and withdrawals are blocked.", "🔴");
    }

    // Check: TVL drop > 20% from last reading
    if (lastTVL > 0n && totalAssets < lastTVL * 80n / 100n) {
      const drop = Number((lastTVL - totalAssets) * 10000n / lastTVL) / 100;
      await sendAlert(
        `📉 *TVL dropped ${drop.toFixed(1)}%*\nPrevious: ${fmtUSDC(lastTVL)}\nCurrent: ${fmtUSDC(totalAssets)}`,
        "🔴"
      );
    }

    // Check: TVL invariant (totalAssets ≈ reserve + deployed)
    const sum = reserve + deployed;
    if (totalAssets > 0n) {
      const drift = totalAssets > sum
        ? Number((totalAssets - sum) * 10000n / totalAssets)
        : Number((sum - totalAssets) * 10000n / totalAssets);
      if (drift > 100) { // > 1% drift
        await sendAlert(
          `⚠️ *TVL Invariant Drift*\ntotalAssets: ${fmtUSDC(totalAssets)}\nreserve + deployed: ${fmtUSDC(sum)}\nDrift: ${(drift / 100).toFixed(2)}%`,
          "🟡"
        );
      }
    }

    lastTVL = totalAssets;

    // Credit utilization check
    const [pool, borrowed] = await Promise.all([
      client.readContract({ address: CREDIT, abi: CREDIT_ABI, functionName: "lendingPool" }),
      client.readContract({ address: CREDIT, abi: CREDIT_ABI, functionName: "totalBorrowed" }),
    ]);

    const total = pool + borrowed;
    const utilization = total > 0n ? Number(borrowed * 10000n / total) / 100 : 0;

    if (utilization > UTILIZATION_WARNING && utilization > lastUtilization) {
      await sendAlert(
        `📊 *Credit utilization high: ${utilization.toFixed(1)}%*\nPool: ${fmtUSDC(pool)}\nBorrowed: ${fmtUSDC(borrowed)}`,
        "🟡"
      );
    }

    lastUtilization = utilization;

    // Log periodic status
    console.log(
      `[HEALTH] TVL: ${fmtUSDC(totalAssets)} | Reserve: ${fmtUSDC(reserve)} | ` +
      `Deployed: ${fmtUSDC(deployed)} | Credit util: ${utilization.toFixed(1)}% | ` +
      `Paused: ${paused} | Alerts: ${alertCount}`
    );

  } catch (e: any) {
    console.error("[HEALTH] Check failed:", e.message);
    await sendAlert(`❌ Health check failed: ${e.message}`, "🔴");
  }
}

// ═══════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════

async function main() {
  console.log("");
  console.log("  ╔══════════════════════════════════════╗");
  console.log("  ║   ARCIS PROTOCOL MONITOR             ║");
  console.log("  ╚══════════════════════════════════════╝");
  console.log("");
  console.log(`  Vault:  ${VAULT}`);
  console.log(`  Credit: ${CREDIT}`);
  console.log(`  Alert threshold: ${fmtUSDC(ALERT_THRESHOLD_USDC)}`);
  console.log(`  Health interval: ${HEALTH_CHECK_INTERVAL / 1000}s`);
  console.log(`  Telegram: ${TELEGRAM_BOT_TOKEN ? "configured" : "not configured (logging only)"}`);
  console.log("");

  // Initial health check
  await runHealthCheck();
  await sendAlert(
    `🟢 Monitor started\nVault: \`${fmtAddr(VAULT)}\`\nThreshold: ${fmtUSDC(ALERT_THRESHOLD_USDC)}`,
    "🟢"
  );

  // Start event watchers
  startEventWatchers();

  // Periodic health checks
  setInterval(runHealthCheck, HEALTH_CHECK_INTERVAL);

  console.log("\n  Monitor running. Press Ctrl+C to stop.\n");
}

main().catch(console.error);
