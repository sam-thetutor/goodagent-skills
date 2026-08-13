import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface SubmissionRecord {
  replyId: string;
  replyUrl: string;
  submittedAt: string;
  pointsAwarded?: number;
  creditsAwarded?: number;
  rewardClaimed?: boolean;
  rewardTxHash?: string;
}

export interface SkillState {
  version: 1;
  /** replyId -> ISO timestamp when first seen (pruned after 14 days) */
  seenReplyIds: Record<string, string>;
  /** YYYY-MM-DD (UTC) -> submissions made that day */
  submittedByDay: Record<string, number>;
  submissions: SubmissionRecord[];
  lastEarnings?: {
    points: number;
    credits: number;
    approved: number;
    rejected: number;
    strikes: number;
    proClaimable: number;
    proTotalClaimed: number;
    fetchedAt: string;
  };
}

const SEEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function loadState(file: string): SkillState {
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as SkillState;
      if (parsed && parsed.version === 1) return parsed;
    } catch {
      console.warn(`[state] could not parse ${file}, starting fresh`);
    }
  }
  return { version: 1, seenReplyIds: {}, submittedByDay: {}, submissions: [] };
}

export function saveState(file: string, state: SkillState): void {
  pruneSeen(state);
  writeFileSync(file, JSON.stringify(state, null, 2));
}

export function markSeen(state: SkillState, replyId: string): void {
  if (!state.seenReplyIds[replyId]) {
    state.seenReplyIds[replyId] = new Date().toISOString();
  }
}

export function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function submissionsToday(state: SkillState): number {
  return state.submittedByDay[utcDayKey()] ?? 0;
}

export function recordSubmission(
  state: SkillState,
  record: SubmissionRecord,
): void {
  state.submissions.push(record);
  const day = utcDayKey();
  state.submittedByDay[day] = (state.submittedByDay[day] ?? 0) + 1;
}

function pruneSeen(state: SkillState): void {
  const cutoff = Date.now() - SEEN_TTL_MS;
  for (const [id, iso] of Object.entries(state.seenReplyIds)) {
    if (new Date(iso).getTime() < cutoff) delete state.seenReplyIds[id];
  }
  // keep day counters for the last 14 days only
  for (const day of Object.keys(state.submittedByDay)) {
    if (new Date(`${day}T00:00:00Z`).getTime() < cutoff) {
      delete state.submittedByDay[day];
    }
  }
}
