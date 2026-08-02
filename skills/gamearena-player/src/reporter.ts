import type { MatchRecord, RefillRecord } from "./bankroll.js";

function hostReportConfig(): { deployId: string; hostUrl: string; secret?: string } | null {
  const deployId = process.env.DEPLOY_ID?.trim();
  const hostUrl = process.env.GOODAGENT_HOST_URL?.trim();
  if (!deployId || !hostUrl) return null;
  const secret = process.env.HOST_INTERNAL_SECRET?.trim();
  return { deployId, hostUrl: hostUrl.replace(/\/$/, ""), secret };
}

function postActivity(payload: Record<string, unknown>): void {
  const cfg = hostReportConfig();
  if (!cfg) return;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cfg.secret) {
    headers.Authorization = `Bearer ${cfg.secret}`;
  }

  void fetch(`${cfg.hostUrl}/deploy/${cfg.deployId}/activity`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }).catch(() => {
    // Host may be down during local runs — never block play.
  });
}

export function reportMatch(rec: MatchRecord): void {
  postActivity({
    type: "match",
    matchId: rec.matchId,
    gameType: rec.gameType,
    wagerGs: rec.wagerGs,
    result: rec.result,
    mode: rec.mode,
    strategy: rec.strategy,
    at: rec.at,
  });
}

export function reportRefill(rec: RefillRecord): void {
  postActivity({
    type: "refill",
    priceGs: rec.priceGs,
    txHash: rec.txHash,
    at: rec.at,
  });
}

export function reportLog(message: string): void {
  postActivity({
    type: "log",
    message,
    at: new Date().toISOString(),
  });
}

export interface LiveMatchSnapshot {
  matchId: string;
  phase: "starting" | "playing" | "ended";
  winsNeeded?: number;
  playerLabel?: string;
  round?: number;
  playerMove?: number;
  aiMove?: number;
  playerMoveLabel?: string;
  roundResult?: "win" | "loss" | "tie";
  readLevel?: number;
  suddenDeath?: boolean;
  markovLine?: string;
  score?: { player: number; ai: number; ties: number };
  final?: {
    outcome: "player_won" | "ai_won" | "tie";
    totalRounds?: number;
    matchLine?: string;
  };
}

export function reportLiveMatch(snapshot: LiveMatchSnapshot): void {
  postActivity({
    type: "live_match",
    ...snapshot,
    updatedAt: new Date().toISOString(),
  });
}

export function reportLiveClear(): void {
  postActivity({ type: "live_clear" });
}

export function reportArenaMatchStart(matchId: string): void {
  postActivity({
    type: "arena_match",
    action: "start",
    matchId,
  });
}

export function reportArenaMatchEnd(matchId: string): void {
  postActivity({
    type: "arena_match",
    action: "end",
    matchId,
  });
}

export function installLogReporter(): void {
  const cfg = hostReportConfig();
  if (!cfg) return;

  const forward =
    /^\[(match|refill|bankroll|start|error|fatal|pause|skip|propose|discovery)\]/i;

  for (const method of ["log", "error", "warn"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      const line = args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      if (forward.test(line)) {
        reportLog(line);
      }
    };
  }
}
