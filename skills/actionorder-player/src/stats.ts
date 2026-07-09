import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface MatchRecord {
  matchId: string;
  character: string;
  result: "won" | "lost";
  roundsWon: number;
  roundsLost: number;
  pointsEarned: number;
  at: string;
}

interface State {
  day: string;
  matchesToday: number;
  pointsToday: number;
  history: MatchRecord[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * File-backed stats + a per-day match cap. vs-house is free to play, so there
 * is no money loss cap here — the safety limit is simply how many matches to
 * play per UTC day, to stay a good citizen of the ACTION-ORDER backend.
 */
export class Stats {
  private state: State;

  constructor(
    private file: string,
    private dailyMatchCap: number,
  ) {
    this.state = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as State)
      : { day: today(), matchesToday: 0, pointsToday: 0, history: [] };
    this.rollover();
  }

  private rollover(): void {
    if (this.state.day !== today()) {
      this.state.day = today();
      this.state.matchesToday = 0;
      this.state.pointsToday = 0;
    }
  }

  canPlay(): { ok: boolean; reason?: string } {
    this.rollover();
    if (this.dailyMatchCap > 0 && this.state.matchesToday >= this.dailyMatchCap) {
      return {
        ok: false,
        reason: `daily match cap reached (${this.state.matchesToday}/${this.dailyMatchCap})`,
      };
    }
    return { ok: true };
  }

  record(rec: MatchRecord): void {
    this.rollover();
    this.state.matchesToday += 1;
    this.state.pointsToday += rec.pointsEarned;
    this.state.history.push(rec);
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  get summary(): string {
    const wins = this.state.history.filter((h) => h.result === "won").length;
    const losses = this.state.history.filter((h) => h.result === "lost").length;
    const points = this.state.history.reduce((n, h) => n + h.pointsEarned, 0);
    return `lifetime ${wins}W/${losses}L · ${points} pts · today ${this.state.matchesToday} matches, ${this.state.pointsToday} pts`;
  }
}
