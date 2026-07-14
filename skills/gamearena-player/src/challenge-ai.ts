import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address } from "viem";

/** Server action names exposed by GameArena challenge-ai (Next.js). */
export const CHALLENGE_ACTIONS = [
  "startArenaMatch",
  "throwArenaMove",
  "getArenaLadder",
  "purchaseArenaRefill",
] as const;

export type ChallengeActionName = (typeof CHALLENGE_ACTIONS)[number];

const REQUIRED_ACTIONS: ChallengeActionName[] = [
  "startArenaMatch",
  "throwArenaMove",
  "getArenaLadder",
  "purchaseArenaRefill",
];

export class ChallengeAiStaleActionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChallengeAiStaleActionsError";
  }
}

/** VPS IP rate limits (403/429/503) — action hashes are still valid; retry later. */
export class GameArenaBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameArenaBlockedError";
  }
}

export interface ChallengeScore {
  player: number;
  ai: number;
  ties: number;
}

export interface ThrowMoveResult {
  round: number;
  playerMove: number;
  aiMove: number;
  result: "win" | "loss" | "tie";
  called?: boolean;
  readLevel?: number;
  suddenDeath?: boolean;
  score: ChallengeScore;
  markovLine?: string;
  final?: {
    outcome: "player_won" | "ai_won" | "tie";
    seed: string;
    commitHash: string;
    totalRounds: number;
    calledCount?: number;
    matchLine?: string;
    modelReveal?: Record<string, unknown>;
  };
  error?: string;
}

export interface RefillOffer {
  sku: string;
  priceGs: number;
  grants: number;
  poolWallet: Address;
  gToken: Address;
  relayer?: Address;
  permitNonce?: string;
}

export interface StartMatchResult {
  matchId?: string;
  commitHash?: string;
  bestOf?: number;
  winsNeeded?: number;
  remainingToday?: number;
  error?: string;
  refill?: RefillOffer;
}

export interface PurchaseRefillResult {
  ok?: boolean;
  remaining?: number;
  error?: string;
}

export interface LadderResult {
  remainingToday?: number;
  top?: Array<{
    wallet: string;
    points: number;
    matches: number;
    wins: number;
    rank: number;
    username: string | null;
  }>;
  me?: { rank?: number; points?: number };
  error?: string;
}

type ActionMap = Partial<Record<ChallengeActionName, string>>;

const ACTION_RE =
  /createServerReference\)\("([a-f0-9]+)"[^"]*"([^"]+)"\)/g;

/** GameArena blocks bare server fetches (403); send browser-like headers from VPS. */
const GAMEARENA_USER_AGENT = "Mozilla/5.0 (compatible; GoodAgent/1.0)";

const GAMEARENA_GET_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,application/javascript,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": GAMEARENA_USER_AGENT,
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
} as const;

const RETRYABLE_STATUSES = new Set([403, 429, 503]);

const DISCOVERY_CACHE_FILE = "gamearena-discovery.json";
const DISCOVERY_CACHE_MS = Number(
  process.env.GAMEARENA_DISCOVERY_CACHE_MS ?? 24 * 60 * 60 * 1000,
);

interface DiscoveryCacheFile {
  baseUrl: string;
  pageUrl: string;
  discoveredAt: string;
  actions: ActionMap;
}

function discoveryCachePath(): string {
  return resolve(process.cwd(), DISCOVERY_CACHE_FILE);
}

function loadDiscoveryCache(pageUrl: string): ActionMap | null {
  const path = discoveryCachePath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as DiscoveryCacheFile;
    if (raw.pageUrl !== pageUrl) return null;
    const age = Date.now() - new Date(raw.discoveredAt).getTime();
    if (!Number.isFinite(age) || age > DISCOVERY_CACHE_MS) return null;
    const missing = REQUIRED_ACTIONS.filter((name) => !raw.actions[name]);
    if (missing.length > 0) return null;
    return raw.actions;
  } catch {
    return null;
  }
}

function saveDiscoveryCache(
  baseUrl: string,
  pageUrl: string,
  actions: ActionMap,
): void {
  const payload: DiscoveryCacheFile = {
    baseUrl,
    pageUrl,
    discoveredAt: new Date().toISOString(),
    actions,
  };
  writeFileSync(discoveryCachePath(), JSON.stringify(payload, null, 2));
}

export function clearDiscoveryCache(): void {
  try {
    const path = discoveryCachePath();
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // ignore
  }
}

export function isGameArenaBlockedError(error: unknown): boolean {
  if (error instanceof GameArenaBlockedError) return true;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    /\((403|429|503)\)/.test(msg) ||
    /failed \(HTTP (403|429|503)\)/i.test(msg) ||
    msg.includes("Failed to fetch GameArena page")
  );
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 5,
): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, init);
    if (res.ok || !RETRYABLE_STATUSES.has(res.status) || i === attempts - 1) {
      return res;
    }
    last = res;
    await new Promise((r) =>
      setTimeout(r, 1000 * 2 ** i + Math.random() * 500),
    );
  }
  return last!;
}

function originFromBase(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

function parseFlightPayload(text: string): unknown {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("1:"));
  if (!line) {
    throw new ChallengeAiStaleActionsError(
      "Unexpected server response — action IDs may be stale. Re-run to re-discover hashes from GameArena bundles.",
    );
  }
  return JSON.parse(line.slice(2)) as unknown;
}

export class ChallengeAiClient {
  private constructor(
    readonly baseUrl: string,
    readonly pageUrl: string,
    private actions: ActionMap,
  ) {}

  static async create(
    baseUrl = "https://gamearenahq.xyz",
  ): Promise<ChallengeAiClient> {
    const origin = originFromBase(baseUrl);
    const pageUrl = `${origin}/games/challenge-ai`;

    const cached = loadDiscoveryCache(pageUrl);
    if (cached) {
      console.log(
        "[discovery] using cached server actions (skip GameArena page fetch)",
      );
      return new ChallengeAiClient(baseUrl, pageUrl, cached);
    }

    const maxAttempts = 6;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const actions = await discoverActions(pageUrl, origin);
        saveDiscoveryCache(baseUrl, pageUrl, actions);
        return new ChallengeAiClient(baseUrl, pageUrl, actions);
      } catch (error) {
        lastError = error as Error;
        const retryable = isGameArenaBlockedError(lastError);
        if (!retryable || attempt === maxAttempts - 1) break;
        const delayMs = 2000 * 2 ** attempt;
        console.error(
          `[discovery] ${lastError.message} — retry ${attempt + 1}/${maxAttempts - 1} in ${Math.round(delayMs / 1000)}s`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    throw lastError!;
  }

  getActionId(name: ChallengeActionName): string {
    const id = this.actions[name];
    if (!id) {
      throw new ChallengeAiStaleActionsError(
        `Missing server action "${name}" in GameArena bundles — redeploy may have changed action IDs. Re-run discovery.`,
      );
    }
    return id;
  }

  async getLadder(playerAddress: Address): Promise<LadderResult> {
    return this.call<LadderResult>("getArenaLadder", [playerAddress]);
  }

  async startMatch(playerAddress: Address): Promise<StartMatchResult> {
    return this.call<StartMatchResult>("startArenaMatch", [playerAddress]);
  }

  async throwMove(matchId: string, move: number): Promise<ThrowMoveResult> {
    return this.call<ThrowMoveResult>("throwArenaMove", [matchId, move]);
  }

  async purchaseRefill(
    playerAddress: Address,
    txHash: string,
  ): Promise<PurchaseRefillResult> {
    return this.call<PurchaseRefillResult>("purchaseArenaRefill", [
      playerAddress,
      txHash,
    ]);
  }

  private async call<T>(action: ChallengeActionName, body: unknown[]): Promise<T> {
    const actionId = this.getActionId(action);
    const origin = originFromBase(this.baseUrl);

    const res = await fetchWithRetry(this.pageUrl, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": GAMEARENA_USER_AGENT,
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "text/plain;charset=UTF-8",
        Origin: origin,
        Referer: this.pageUrl,
        "Next-Action": actionId,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (RETRYABLE_STATUSES.has(res.status)) {
        throw new GameArenaBlockedError(
          `GameArena ${action} failed (HTTP ${res.status})`,
        );
      }
      throw new ChallengeAiStaleActionsError(
        `GameArena ${action} failed (HTTP ${res.status}) — action ID ${actionId} may be stale after a site redeploy.`,
      );
    }

    const text = await res.text();
    try {
      return parseFlightPayload(text) as T;
    } catch (error) {
      if (error instanceof ChallengeAiStaleActionsError) throw error;
      throw new ChallengeAiStaleActionsError(
        `Failed to parse GameArena ${action} response — action IDs may be stale.`,
      );
    }
  }
}

async function discoverActions(
  pageUrl: string,
  origin: string,
): Promise<ActionMap> {
  const pageRes = await fetchWithRetry(pageUrl, {
    headers: GAMEARENA_GET_HEADERS,
  });
  if (!pageRes.ok) {
    if (RETRYABLE_STATUSES.has(pageRes.status)) {
      throw new GameArenaBlockedError(
        `Failed to fetch GameArena page (${pageRes.status})`,
      );
    }
    throw new Error(`Failed to fetch GameArena page (${pageRes.status})`);
  }

  const html = await pageRes.text();
  const chunkPaths = [
    ...new Set(
      [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map(
        (m) => m[1],
      ),
    ),
  ];

  if (chunkPaths.length === 0) {
    throw new ChallengeAiStaleActionsError(
      "No JS bundles found on GameArena challenge-ai page — cannot discover server action hashes.",
    );
  }

  const actions: ActionMap = {};

  await Promise.all(
    chunkPaths.map(async (path) => {
      try {
        const res = await fetchWithRetry(`${origin}${path}`, {
          headers: GAMEARENA_GET_HEADERS,
        });
        if (!res.ok) return;
        const js = await res.text();
        let match: RegExpExecArray | null;
        ACTION_RE.lastIndex = 0;
        while ((match = ACTION_RE.exec(js)) !== null) {
          const [, hash, name] = match;
          if (CHALLENGE_ACTIONS.includes(name as ChallengeActionName)) {
            actions[name as ChallengeActionName] = hash;
          }
        }
      } catch {
        // Skip unreachable chunks; required actions validated below.
      }
    }),
  );

  const missing = REQUIRED_ACTIONS.filter((name) => !actions[name]);
  if (missing.length > 0) {
    throw new ChallengeAiStaleActionsError(
      `Could not discover server actions: ${missing.join(", ")}. GameArena may have redeployed — check ${pageUrl} manually.`,
    );
  }

  return actions;
}
