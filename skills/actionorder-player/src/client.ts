/**
 * Thin client for ACTION-ORDER's vs-house match API (CELO-cards production).
 *
 * The game logic and match state live on the game's server behind a single
 * route: POST /api/match/vshouse/resolve, one call per round, exactly like the
 * human client. The first call for a new matchId initialises Redis-backed
 * match state and pins the reward difficulty; later calls can never raise the
 * payout. Scoring, daily bounty caps and leaderboard recording all happen
 * server-side.
 */

export interface ResolveRoundRequest {
  matchId: string;
  playerAddress: string;
  playerName: string;
  playerCharacterId: string;
  opponentCharacterId: string;
  playerOrderCardIds: string[];
  /** Pinned server-side on the first call of the match. */
  difficulty: number;
  wagered: boolean;
  playerUltimateActivated: boolean;
  attunedCardIds: string[];
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
  /** Win finished past the daily bounty allowance — points didn't count. */
  bountyCapReached?: boolean;
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
        bountyCapReached: data.bountyCapReached ?? false,
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
