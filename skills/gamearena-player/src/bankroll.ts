import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type PlayMode = "offchain" | "onchain";

export interface MatchRecord {
  matchId: string;
  gameType: number;
  wagerGs: number;
  result: "won" | "lost" | "unresolved";
  mode: PlayMode;
  at: string;
}

interface State {
  day: string;
  lostTodayGs: number;
  matchesToday: number;
  history: MatchRecord[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * File-backed daily limits. On-chain mode tracks G$ lost; off-chain tracks
 * match count against the server ticket allowance.
 */
export class Bankroll {
  private state: State;

  constructor(
    private file: string,
    private mode: PlayMode,
    private dailyLossCapGs: number,
    private dailyMatchCap: number,
  ) {
    this.state = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as State)
      : { day: today(), lostTodayGs: 0, matchesToday: 0, history: [] };
    this.rollover();
    this.migrateLegacyRecords();
  }

  private migrateLegacyRecords(): void {
    for (const rec of this.state.history) {
      if (!rec.mode) rec.mode = "onchain";
    }
  }

  private rollover(): void {
    if (this.state.day !== today()) {
      this.state.day = today();
      this.state.lostTodayGs = 0;
      this.state.matchesToday = 0;
    }
  }

  canPlay(wagerGs: number): { ok: boolean; reason?: string } {
    this.rollover();
    if (this.mode === "offchain") {
      if (this.state.matchesToday >= this.dailyMatchCap) {
        return {
          ok: false,
          reason: `daily match cap: played ${this.state.matchesToday} of ${this.dailyMatchCap} matches today`,
        };
      }
      return { ok: true };
    }
    if (this.state.lostTodayGs + wagerGs > this.dailyLossCapGs) {
      return {
        ok: false,
        reason: `daily loss cap: lost ${this.state.lostTodayGs} G$ of ${this.dailyLossCapGs} G$ cap, next wager ${wagerGs} G$ would exceed it`,
      };
    }
    return { ok: true };
  }

  record(rec: MatchRecord): void {
    this.rollover();
    this.state.matchesToday += 1;
    if (rec.result === "lost" && rec.mode === "onchain") {
      this.state.lostTodayGs += rec.wagerGs;
    }
    this.state.history.push(rec);
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  get summary(): string {
    const wins = this.state.history.filter((h) => h.result === "won").length;
    const losses = this.state.history.filter((h) => h.result === "lost").length;
    if (this.mode === "offchain") {
      return `lifetime ${wins}W/${losses}L · today ${this.state.matchesToday}/${this.dailyMatchCap} matches`;
    }
    return `lifetime ${wins}W/${losses}L · today ${this.state.matchesToday} matches, ${this.state.lostTodayGs} G$ lost`;
  }
}
