/**
 * Thin client for ACTION-ORDER's vs-house match API. The game logic and match
 * state live on ACTION-ORDER's server, so a round is one HTTP call: we submit
 * our locked order and the server returns the house AI's order, the knock
 * totals, and the running round score for the match id.
 *
 * Security contract (CELO-cards / production):
 * - POST /api/match/vshouse/start pins difficulty server-side
 * - POST /api/match/vshouse/resolve never trusts difficulty from the client
 * - Both routes require x-agent-key when ACTIONORDER_AGENT_API_KEY is set
 */

export interface StartMatchRequest {
  matchId: string;
  playerAddress: string;
  playerName: string;
  playerCharacterId: string;
  opponentCharacterId: string;
  /** 0 = easiest house AI — sent once at match start only. */
  difficulty: number;
  wagered: boolean;
}

export interface ResolveRoundRequest {
  matchId: string;
  playerAddress: string;
  playerOrderCardIds: string[];
  playerUltimateActivated: boolean;
  attunedCardIds: string[];
}

/** @deprecated Legacy combined shape — prefer start + resolveRound. */
export interface ResolveRequest extends ResolveRoundRequest {
  playerName: string;
  playerCharacterId: string;
  opponentCharacterId: string;
  difficulty: number;
  wagered: boolean;
}

export interface ResolveResponse {
  ok: boolean;
  aiOrder: string[];
  totalPlayerKnock: number;
  totalOpponentKnock: number;
  roundWinner: "player" | "opponent" | "draw";
  isMatchOver: boolean;
  pointsEarned: number;
  playerRoundsWon: number;
  opponentRoundsWon: number;
}

export class ActionOrderClient {
  constructor(
    private baseUrl = "https://www.actionorder.xyz",
    private timeoutMs = 20_000,
    private agentApiKey?: string,
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = this.agentApiKey?.trim();
    if (key) headers["x-agent-key"] = key;
    return headers;
  }

  async startMatch(req: StartMatchRequest): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/match/vshouse/start`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`start failed (${res.status}): ${text.slice(0, 200)}`);
      }
      let json: { ok?: boolean; error?: string };
      try {
        json = JSON.parse(text) as { ok?: boolean; error?: string };
      } catch {
        throw new Error(`start returned non-JSON: ${text.slice(0, 200)}`);
      }
      if (!json.ok) {
        throw new Error(`start rejected: ${json.error ?? text.slice(0, 200)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async resolveRound(req: ResolveRoundRequest): Promise<ResolveResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/match/vshouse/resolve`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`resolve failed (${res.status}): ${text.slice(0, 200)}`);
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`resolve returned non-JSON: ${text.slice(0, 200)}`);
      }
      const data = json as Partial<ResolveResponse>;
      if (!data.ok) {
        throw new Error(`resolve rejected: ${text.slice(0, 200)}`);
      }
      return {
        ok: true,
        aiOrder: data.aiOrder ?? [],
        totalPlayerKnock: data.totalPlayerKnock ?? 0,
        totalOpponentKnock: data.totalOpponentKnock ?? 0,
        roundWinner: data.roundWinner ?? "draw",
        isMatchOver: data.isMatchOver ?? false,
        pointsEarned: data.pointsEarned ?? 0,
        playerRoundsWon: data.playerRoundsWon ?? 0,
        opponentRoundsWon: data.opponentRoundsWon ?? 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async online(): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/online`, {
        signal: controller.signal,
      });
      if (!res.ok) return 0;
      const json = (await res.json()) as { online?: number };
      return json.online ?? 0;
    } catch {
      return 0;
    } finally {
      clearTimeout(timer);
    }
  }
}
