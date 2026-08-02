import type { Address } from "viem";
import { gamearenaFetch } from "./gamearena-fetch.js";
import type {
  ChallengeScore,
  LadderResult,
  StartMatchResult,
  ThrowMoveResult,
} from "./challenge-ai.js";

const DEFAULT_AGENT_API_URL =
  "https://game-backend-production-6130.up.railway.app";

/** Off-chain play client surface shared by challenge-ai and scoped agent API. */
export interface OffchainPlayClient {
  startMatch(playerAddress: Address): Promise<StartMatchResult>;
  throwMove(matchId: string, move: number): Promise<ThrowMoveResult>;
  getLadder(playerAddress: Address): Promise<LadderResult>;
  supportsRefill(): boolean;
}

export function isAgentApiConfigured(): boolean {
  return Boolean(process.env.GAMEARENA_AGENT_API_KEY?.trim());
}

function pickStr(
  obj: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNum(
  obj: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function pickRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function mapRoundResult(
  value: unknown,
): "win" | "loss" | "tie" | undefined {
  if (value === "win" || value === "loss" || value === "tie") return value;
  if (typeof value !== "string") return undefined;
  const v = value.toLowerCase();
  if (v === "win" || v === "won" || v === "player_won") return "win";
  if (v === "loss" || v === "lost" || v === "player_lost" || v === "ai_won") {
    return "loss";
  }
  if (v === "tie" || v === "draw") return "tie";
  return undefined;
}

function mapFinalOutcome(
  value: unknown,
): "player_won" | "ai_won" | "tie" | undefined {
  if (value === "player_won" || value === "ai_won" || value === "tie") {
    return value;
  }
  if (typeof value !== "string") return undefined;
  const v = value.toLowerCase();
  if (v === "player_won" || v === "won" || v === "win") return "player_won";
  if (v === "ai_won" || v === "lost" || v === "loss") return "ai_won";
  if (v === "tie" || v === "draw") return "tie";
  return undefined;
}

function mapScore(raw: unknown): ChallengeScore {
  const o = pickRecord(raw) ?? {};
  return {
    player: pickNum(o, "player", "playerScore", "player_score") ?? 0,
    ai: pickNum(o, "ai", "aiScore", "ai_score") ?? 0,
    ties: pickNum(o, "ties", "tie", "tieScore", "tie_score") ?? 0,
  };
}

function mapStartResult(raw: unknown): StartMatchResult {
  if (!raw || typeof raw !== "object") {
    return { error: "invalid_response" };
  }
  const o = raw as Record<string, unknown>;
  const nested = pickRecord(o.data) ?? pickRecord(o.result) ?? o;
  const error =
    pickStr(o, "error", "message") ??
    pickStr(nested, "error", "message");
  const matchId =
    pickStr(nested, "matchId", "match_id", "id") ??
    pickStr(o, "matchId", "match_id", "id");
  if (error && !matchId) {
    return { error, matchId: undefined };
  }
  return {
    matchId,
    commitHash:
      pickStr(nested, "commitHash", "commit_hash", "commit") ??
      pickStr(o, "commitHash", "commit_hash", "commit"),
    bestOf: pickNum(nested, "bestOf", "best_of") ?? pickNum(o, "bestOf", "best_of"),
    winsNeeded:
      pickNum(nested, "winsNeeded", "wins_needed") ??
      pickNum(o, "winsNeeded", "wins_needed"),
    remainingToday:
      pickNum(nested, "remainingToday", "remaining_today") ??
      pickNum(o, "remainingToday", "remaining_today"),
    error: error && !matchId ? error : undefined,
  };
}

function mapThrowResult(raw: unknown): ThrowMoveResult {
  if (!raw || typeof raw !== "object") {
    return { error: "invalid_response", round: 0, playerMove: 0, aiMove: 0, result: "tie", score: { player: 0, ai: 0, ties: 0 } };
  }
  const o = raw as Record<string, unknown>;
  const nested = pickRecord(o.data) ?? pickRecord(o.result) ?? o;
  const error =
    pickStr(o, "error", "message") ??
    pickStr(nested, "error", "message");
  if (error) {
    return {
      error,
      round: pickNum(nested, "round") ?? 0,
      playerMove: pickNum(nested, "playerMove", "player_move", "move") ?? 0,
      aiMove: pickNum(nested, "aiMove", "ai_move") ?? 0,
      result: mapRoundResult(nested.result ?? o.result) ?? "tie",
      score: mapScore(nested.score ?? o.score),
    };
  }

  const finalRaw = pickRecord(nested.final) ?? pickRecord(o.final);
  const finalOutcome =
    mapFinalOutcome(finalRaw?.outcome ?? nested.outcome ?? o.outcome) ??
    (nested.done === true || nested.complete === true || o.done === true
      ? mapFinalOutcome(nested.winner ?? o.winner)
      : undefined);

  const roundResult =
    mapRoundResult(nested.result ?? o.result) ??
    mapRoundResult(nested.roundResult ?? o.roundResult) ??
    "tie";

  return {
    round: pickNum(nested, "round", "roundNumber", "round_number") ?? 0,
    playerMove:
      pickNum(nested, "playerMove", "player_move", "move") ?? 0,
    aiMove: pickNum(nested, "aiMove", "ai_move") ?? 0,
    result: roundResult,
    called: nested.called === true || o.called === true,
    readLevel: pickNum(nested, "readLevel", "read_level"),
    suddenDeath: nested.suddenDeath === true || o.suddenDeath === true,
    score: mapScore(nested.score ?? o.score),
    markovLine:
      pickStr(nested, "markovLine", "markov_line") ??
      pickStr(o, "markovLine", "markov_line"),
    final: finalOutcome
      ? {
          outcome: finalOutcome,
          seed:
            pickStr(finalRaw, "seed") ??
            pickStr(nested, "seed") ??
            pickStr(o, "seed") ??
            "",
          commitHash:
            pickStr(finalRaw, "commitHash", "commit_hash") ??
            pickStr(nested, "commitHash", "commit_hash") ??
            "",
          totalRounds:
            pickNum(finalRaw, "totalRounds", "total_rounds") ??
            pickNum(nested, "round", "roundNumber") ??
            0,
          matchLine:
            pickStr(finalRaw, "matchLine", "match_line") ??
            pickStr(nested, "matchLine", "match_line"),
        }
      : undefined,
  };
}

export class GameArenaAgentApiClient implements OffchainPlayClient {
  readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey.trim();
    if (!this.apiKey) {
      throw new Error("GAMEARENA_AGENT_API_KEY is required for agent API play");
    }
  }

  static fromEnv(): GameArenaAgentApiClient {
    const apiKey = process.env.GAMEARENA_AGENT_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("GAMEARENA_AGENT_API_KEY is not set");
    }
    const baseUrl =
      process.env.GAMEARENA_AGENT_API_URL?.trim() || DEFAULT_AGENT_API_URL;
    return new GameArenaAgentApiClient(baseUrl, apiKey);
  }

  supportsRefill(): boolean {
    return false;
  }

  async getLadder(_playerAddress: Address): Promise<LadderResult> {
    return { remainingToday: undefined };
  }

  async startMatch(playerAddress: Address): Promise<StartMatchResult> {
    return this.post("/api/arena/agent/start", { agentAddress: playerAddress }, mapStartResult);
  }

  async throwMove(matchId: string, move: number): Promise<ThrowMoveResult> {
    return this.post(
      "/api/arena/agent/throw",
      { matchId, move },
      mapThrowResult,
    );
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
    map: (raw: unknown) => T,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await gamearenaFetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-agent-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let raw: unknown;
    try {
      raw = text ? JSON.parse(text) : {};
    } catch {
      if (!res.ok) {
        return map({
          error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        });
      }
      return map({ error: "invalid_json_response" });
    }

    if (!res.ok) {
      const o = raw as Record<string, unknown>;
      const message =
        pickStr(o, "error", "message") ??
        `HTTP ${res.status}`;
      return map({ ...o, error: message });
    }

    return map(raw);
  }
}
