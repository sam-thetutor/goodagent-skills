export type RuntimeConfig = {
  apiBase: string;
  apiKey: string;
  xHandle: string;
  scanSeconds: number;
  dailySubmitCap: number;
  maxPendingDrafts: number;
  feedActionType: string;
  runOnce: boolean;
  dryRun: boolean;
  enableProClaim: boolean;
  baseRpcUrl: string;
  llmBaseUrl: string;
  llmModel: string | null;
  llmApiKey: string | null;
  stateFile: string;
  queueFile: string;
};

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes";
}

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]?.trim() ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadRuntimeConfig(): RuntimeConfig {
  const apiKey = process.env.PRODUCTCLANK_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "[fatal] PRODUCTCLANK_API_KEY is not set — run `npm run register` first",
    );
    process.exit(1);
  }

  return {
    apiBase:
      process.env.PRODUCTCLANK_API_BASE?.trim().replace(/\/$/, "") ||
      "https://api.productclank.com/api/v1",
    apiKey,
    xHandle: process.env.X_HANDLE?.trim().replace(/^@/, "") ?? "",
    scanSeconds: envNumber("SCAN_INTERVAL_SECONDS", 1800),
    dailySubmitCap: envNumber("DAILY_SUBMIT_CAP", 10),
    maxPendingDrafts: envNumber("MAX_PENDING_DRAFTS", 5),
    feedActionType: process.env.FEED_ACTION_TYPE?.trim() || "reply",
    runOnce: envFlag("RUN_ONCE"),
    dryRun: envFlag("DRY_RUN"),
    enableProClaim: envFlag("ENABLE_PRO_CLAIM", true),
    baseRpcUrl: process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org",
    llmBaseUrl:
      process.env.LLM_BASE_URL?.trim().replace(/\/$/, "") ||
      "http://localhost:8377/v1",
    llmModel: process.env.LLM_MODEL?.trim() || null,
    llmApiKey: process.env.LLM_API_KEY?.trim() || null,
    stateFile: process.env.STATE_FILE?.trim() || "./state.json",
    queueFile: process.env.QUEUE_FILE?.trim() || "./amplify-queue.json",
  };
}
