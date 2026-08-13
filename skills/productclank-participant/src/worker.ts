import { ProductClankApi, sanitizeServerText } from "./api.js";
import { runProClaimPass } from "./claim.js";
import type { RuntimeConfig } from "./config.js";
import { loadQueue, saveQueue, type PendingDraft } from "./queue.js";
import { reviewDraft } from "./review.js";
import {
  loadState,
  markSeen,
  recordSubmission,
  saveState,
  submissionsToday,
  type SkillState,
} from "./state.js";

export async function runWorkerPass(config: RuntimeConfig): Promise<void> {
  const api = new ProductClankApi(config.apiBase, config.apiKey);
  const state = loadState(config.stateFile);

  try {
    await submitPostedReplies(config, api, state);
    await refillPendingQueue(config, api, state);
    await refreshEarnings(api, state);
    if (config.enableProClaim) {
      await runProClaimPass(config, api, state);
    }
  } finally {
    saveState(config.stateFile, state);
  }

  const queue = loadQueue(config.queueFile);
  console.log(
    `[pass] done — pending drafts: ${queue.pending.length}, awaiting submit: ${queue.posted.length}, submitted today: ${submissionsToday(state)}/${config.dailySubmitCap}`,
  );
}

/** Step 1: submit replies the operator has posted (queue.posted). */
async function submitPostedReplies(
  config: RuntimeConfig,
  api: ProductClankApi,
  state: SkillState,
): Promise<void> {
  const queue = loadQueue(config.queueFile);
  if (queue.posted.length === 0) return;

  const remaining: typeof queue.posted = [];
  for (const posted of queue.posted) {
    if (submissionsToday(state) >= config.dailySubmitCap) {
      console.log("[submit] daily cap reached — deferring remaining posts");
      remaining.push(posted);
      continue;
    }
    if (config.dryRun) {
      console.log(`[submit] DRY_RUN — would submit ${posted.replyId}`);
      remaining.push(posted);
      continue;
    }

    const result = await api.submit(posted.replyId, posted.replyUrl);
    if (result.success) {
      console.log(
        `[submit] accepted ${posted.replyId} — +${result.pointsAwarded ?? 0} points, +${result.creditsAwarded ?? 0} credits`,
      );
      recordSubmission(state, {
        replyId: posted.replyId,
        replyUrl: posted.replyUrl,
        submittedAt: new Date().toISOString(),
        pointsAwarded: result.pointsAwarded,
        creditsAwarded: result.creditsAwarded,
      });
      queue.pending = queue.pending.filter((p) => p.replyId !== posted.replyId);
    } else if (result.error === "tweet_unreachable") {
      console.warn(
        `[submit] ${posted.replyId}: tweet not indexed yet, will retry next pass`,
      );
      remaining.push(posted);
    } else {
      // Permanent failures (author mismatch, already claimed, …): drop from
      // the queue so the operator is not asked again, but keep a log trail.
      console.warn(
        `[submit] ${posted.replyId} rejected: ${result.error} — ${result.message ?? ""}`,
      );
      queue.pending = queue.pending.filter((p) => p.replyId !== posted.replyId);
    }
  }
  queue.posted = remaining;
  saveQueue(config.queueFile, queue);
}

/** Step 2: pull fresh drafts from the feed, review, and queue for approval. */
async function refillPendingQueue(
  config: RuntimeConfig,
  api: ProductClankApi,
  state: SkillState,
): Promise<void> {
  const queue = loadQueue(config.queueFile);
  const budgetToday = config.dailySubmitCap - submissionsToday(state);
  const room = Math.min(
    config.maxPendingDrafts - queue.pending.length,
    Math.max(budgetToday - queue.posted.length, 0),
  );
  if (room <= 0) return;

  let posts;
  try {
    posts = await api.feed({ limit: 50, actionType: config.feedActionType });
  } catch (error) {
    console.warn(`[feed] ${(error as Error).message}`);
    return;
  }

  let queued = 0;
  for (const post of posts) {
    if (queued >= room) break;
    for (const draft of post.unclaimedReplies ?? []) {
      if (queued >= room) break;
      if (state.seenReplyIds[draft.id]) continue;
      markSeen(state, draft.id);

      const review = await reviewDraft(config, {
        campaignTitle: post.campaign?.title,
        tweetText: post.tweetText,
        tweetAuthor: post.author?.username,
        replyText: draft.replyText,
      });

      if (review.verdict === "reject") {
        console.log(
          `[review] skipping ${draft.id}: ${review.note ?? "rejected by reviewer"}`,
        );
        continue;
      }

      const entry: PendingDraft = {
        replyId: draft.id,
        replyText: sanitizeServerText(draft.replyText),
        actionType: draft.actionType,
        tweetUrl: post.tweetUrl,
        tweetText: sanitizeServerText(post.tweetText),
        tweetAuthor: post.author?.username,
        campaignTitle: post.campaign?.title,
        review:
          review.verdict === "approve"
            ? { verdict: "approve", note: review.note }
            : { verdict: "unreviewed" },
        queuedAt: new Date().toISOString(),
      };
      queue.pending.push(entry);
      queued += 1;
      console.log(
        `[feed] queued draft ${draft.id} (${review.verdict}) for tweet by @${post.author?.username ?? "?"}`,
      );
    }
  }

  if (queued > 0) {
    saveQueue(config.queueFile, queue);
    console.log(
      `[feed] ${queued} new draft(s) awaiting operator approval in ${config.queueFile}`,
    );
  }
}

/** Step 3: refresh earnings snapshot for dashboards and strike monitoring. */
async function refreshEarnings(
  api: ProductClankApi,
  state: SkillState,
): Promise<void> {
  try {
    const earnings = await api.earnings();
    if (!earnings.success) return;
    state.lastEarnings = {
      points: earnings.points ?? 0,
      credits: earnings.credits ?? 0,
      approved: earnings.replies?.approved ?? 0,
      rejected: earnings.replies?.rejected ?? 0,
      strikes: earnings.replies?.strikes ?? 0,
      proClaimable: earnings.proClaim?.claimableCount ?? 0,
      proTotalClaimed: earnings.proClaim?.totalClaimed ?? 0,
      fetchedAt: new Date().toISOString(),
    };
    if ((earnings.replies?.strikes ?? 0) > 0) {
      console.warn(
        `[earnings] WARNING: ${earnings.replies?.strikes} strike(s) — 3 strikes block the agent. Review drafts more carefully.`,
      );
    }
  } catch (error) {
    console.warn(`[earnings] ${(error as Error).message}`);
  }
}
