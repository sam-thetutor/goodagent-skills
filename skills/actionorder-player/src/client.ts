/**
 * Thin client for ACTION-ORDER's vs-house match API. The game logic and match
 * state live on ACTION-ORDER's server, so a round is one HTTP call: we submit
 * our locked order and the server returns the house AI's order, the knock
 * totals, and the running round score for the match id.
 *
 * NOTE: this is an unofficial endpoint reverse-engineered from the live client.
 * It may change without notice. The default mode is free (no wager); wagered
 * play settles through ACTION-ORDER's own escrow and is out of scope here.
 */

export interface ResolveRequest {
  matchId: string;
  playerAddress: string;
  playerName: string;
  playerCharacterId: string;
  opponentCharacterId: string;
  playerOrderCardIds: string[];
  /** 0 = easiest house AI. */
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
}

export class ActionOrderClient {
  constructor(
    private baseUrl = "https://www.actionorder.xyz",
    private timeoutMs = 20_000,
  ) {}

  async resolveRound(req: ResolveRequest): Promise<ResolveResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/match/vshouse/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  /** How many players are currently online (used as a liveness check). */
  async online(): Promise<number> {
    const res = await fetch(`${this.baseUrl}/api/online`);
    if (!res.ok) return 0;
    const data = (await res.json()) as { online?: number };
    return data.online ?? 0;
  }
}
