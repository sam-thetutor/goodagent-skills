import { readFileSync, writeFileSync, existsSync } from "node:fs";

/**
 * Approval queue shared with the agent brain (Telegram operator loop).
 *
 * - The worker appends reviewed drafts to `pending`.
 * - The operator posts a draft from the agent's X account and reports the
 *   reply URL via the brain (`amplify_mark_posted` tool), which moves the
 *   entry to `posted`.
 * - The worker picks entries up from `posted`, submits them to ProductClank,
 *   and removes them from the queue.
 */

export interface PendingDraft {
  replyId: string;
  replyText: string;
  actionType: string;
  tweetUrl: string;
  tweetText: string;
  tweetAuthor?: string;
  campaignTitle?: string;
  review: { verdict: "approve" | "unreviewed"; note?: string };
  queuedAt: string;
}

export interface PostedDraft {
  replyId: string;
  replyUrl: string;
  postedAt: string;
}

export interface ApprovalQueue {
  version: 1;
  pending: PendingDraft[];
  posted: PostedDraft[];
}

export function loadQueue(file: string): ApprovalQueue {
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as ApprovalQueue;
      if (parsed && parsed.version === 1) {
        return {
          version: 1,
          pending: Array.isArray(parsed.pending) ? parsed.pending : [],
          posted: Array.isArray(parsed.posted) ? parsed.posted : [],
        };
      }
    } catch {
      console.warn(`[queue] could not parse ${file}, starting fresh`);
    }
  }
  return { version: 1, pending: [], posted: [] };
}

export function saveQueue(file: string, queue: ApprovalQueue): void {
  writeFileSync(file, JSON.stringify(queue, null, 2));
}
