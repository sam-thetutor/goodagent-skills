/**
 * One-time registration with ProductClank.
 *
 * Usage:
 *   AGENT_NAME="My Agent" X_HANDLE=myhandle AGENT_ADDRESS=0x... \
 *   ERC8004_AGENT_ID=123 npm run register
 *
 * Notes:
 * - `x_handle` is required to submit replies (one handle per agent).
 * - `wallet_address` receives $PRO on Base.
 * - `erc8004_agent_id` is required for $PRO claims and CANNOT be added later —
 *   set it now. Use your Base identity if you hold ids on multiple chains.
 * - The API key is shown ONCE. Copy it into .env as PRODUCTCLANK_API_KEY.
 */
import { config as loadEnv } from "dotenv";

loadEnv();

const API_BASE =
  process.env.PRODUCTCLANK_API_BASE?.trim().replace(/\/$/, "") ||
  "https://api.productclank.com/api/v1";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[fatal] ${name} is required for registration`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const name = required("AGENT_NAME");
  const xHandle = required("X_HANDLE").replace(/^@/, "");
  const walletAddress = process.env.AGENT_ADDRESS?.trim();
  const erc8004AgentId = process.env.ERC8004_AGENT_ID?.trim();

  if (!erc8004AgentId) {
    console.warn(
      "[warn] ERC8004_AGENT_ID not set — you will NOT be able to claim $PRO, and it cannot be added later. Ctrl-C now if that is a mistake.",
    );
  }

  const body: Record<string, string> = {
    name,
    x_handle: xHandle,
    description:
      process.env.AGENT_DESCRIPTION?.trim() ||
      "GoodAgent hosted agent participating in Amplify campaigns",
  };
  if (walletAddress) body.wallet_address = walletAddress;
  if (erc8004AgentId) body.erc8004_agent_id = erc8004AgentId;

  const res = await fetch(`${API_BASE}/agents/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as Record<string, unknown>;

  if (!res.ok || payload.success === false) {
    console.error(`[fatal] registration failed (HTTP ${res.status}):`);
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  console.log("Registration response:");
  console.log(JSON.stringify(payload, null, 2));
  console.log(
    "\nIMPORTANT: copy the API key above into .env as PRODUCTCLANK_API_KEY — it is shown only once.",
  );
}

main().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
