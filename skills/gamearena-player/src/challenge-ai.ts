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
const GAMEARENA_FETCH_HEADERS = {
  Accept: "text/html,application/javascript,*/*;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (compatible; GoodAgent/1.0; +https://goodagentids.xyz)",
} as const;

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
    const actions = await discoverActions(pageUrl, origin);
    return new ChallengeAiClient(baseUrl, pageUrl, actions);
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

    const res = await fetch(this.pageUrl, {
      method: "POST",
      headers: {
        ...GAMEARENA_FETCH_HEADERS,
        "Content-Type": "text/plain;charset=UTF-8",
        Origin: origin,
        Referer: this.pageUrl,
        "Next-Action": actionId,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
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
  const pageRes = await fetch(pageUrl, {
    headers: GAMEARENA_FETCH_HEADERS,
  });
  if (!pageRes.ok) {
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
        const res = await fetch(`${origin}${path}`, {
          headers: GAMEARENA_FETCH_HEADERS,
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
