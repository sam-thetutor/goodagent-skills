/**
 * Subscriber storage lives in the central GoodAgent database, reached through
 * the host's internal /deploy/:id/telegram/* endpoints. Every row is scoped by
 * DEPLOY_ID so many reminder bots can share the table.
 */

export interface Subscriber {
  id: string;
  chatId: string;
  wallet: string;
  lastRemindedDay: string | null;
  lastClaimedDay: string | null;
  streak: number;
  bestStreak: number;
}

export interface LeaderboardRow {
  wallet: string;
  streak: number;
  bestStreak: number;
}

function baseUrl(): string {
  const deployId = process.env.DEPLOY_ID?.trim();
  const hostUrl = process.env.GOODAGENT_HOST_URL?.trim();
  if (!deployId || !hostUrl) {
    throw new Error("DEPLOY_ID and GOODAGENT_HOST_URL must be set");
  }
  return `${hostUrl.replace(/\/$/, "")}/deploy/${deployId}/telegram`;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.HOST_INTERNAL_SECRET?.trim();
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`host ${method} ${path} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function listAllSubscribers(): Promise<Subscriber[]> {
  const data = await call<{ subscribers: Subscriber[] }>("GET", "/subscribers");
  return data.subscribers;
}

export async function listChatWallets(chatId: string): Promise<Subscriber[]> {
  const data = await call<{ subscribers: Subscriber[] }>(
    "GET",
    `/subscribers?chatId=${encodeURIComponent(chatId)}`,
  );
  return data.subscribers;
}

export async function subscribe(
  chatId: string,
  wallet: string,
): Promise<void> {
  await call("POST", "/subscribe", { chatId, wallet });
}

export async function unsubscribe(
  chatId: string,
  wallet?: string,
): Promise<number> {
  const data = await call<{ removed: number }>("POST", "/unsubscribe", {
    chatId,
    wallet,
  });
  return data.removed;
}

export async function markReminded(ids: string[], day: string): Promise<void> {
  if (ids.length === 0) return;
  await call("POST", "/reminded", { ids, day });
}

export async function recordClaims(
  wallets: string[],
  day: string,
): Promise<void> {
  if (wallets.length === 0) return;
  await call("POST", "/claims", { wallets, day });
}

export async function leaderboard(limit = 10): Promise<LeaderboardRow[]> {
  const data = await call<{ leaderboard: LeaderboardRow[] }>(
    "GET",
    `/leaderboard?limit=${limit}`,
  );
  return data.leaderboard;
}

export async function deactivateChats(chatIds: string[]): Promise<void> {
  if (chatIds.length === 0) return;
  await call("POST", "/deactivate", { chatIds });
}

export function reportLog(message: string): void {
  const deployId = process.env.DEPLOY_ID?.trim();
  const hostUrl = process.env.GOODAGENT_HOST_URL?.trim();
  if (!deployId || !hostUrl) return;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.HOST_INTERNAL_SECRET?.trim();
  if (secret) headers.Authorization = `Bearer ${secret}`;
  void fetch(`${hostUrl.replace(/\/$/, "")}/deploy/${deployId}/activity`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "log", message, at: new Date().toISOString() }),
  }).catch(() => {
    // Host may be down — never block the bot.
  });
}
