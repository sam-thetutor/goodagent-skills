import { fmtGs, type PoolStats, type WalletSnapshot } from "./chain.js";
import type { LeaderboardRow, Subscriber } from "./store.js";

export const CLAIM_URL = "https://gooddapp.org";

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function streakBadge(streak: number): string {
  if (streak >= 30) return "🏆";
  if (streak >= 7) return "🔥";
  if (streak >= 3) return "⚡";
  return "";
}

/** One status line per wallet for /status and post-subscribe checks. */
export function statusLine(
  snap: WalletSnapshot,
  sub?: Pick<Subscriber, "streak">,
): string {
  const addr = `<code>${shortAddress(snap.wallet)}</code>`;
  const streak =
    sub && sub.streak > 1
      ? ` · ${streakBadge(sub.streak)} ${sub.streak}-day streak`
      : "";
  if (snap.eligible) {
    return `🟢 ${addr} — <b>${fmtGs(snap.entitlement)} G$</b> ready to claim!${streak}`;
  }
  if (!snap.isWhitelisted) {
    return `⚪️ ${addr} — not GoodDollar-verified yet. Verify in the GoodWallet app to start claiming.`;
  }
  return `✅ ${addr} — already claimed today.${streak} Next claim opens at 12:00 UTC.`;
}

export function reminderMessage(
  rows: Array<{ snap: WalletSnapshot; sub: Subscriber }>,
  expiryWarnings: string[],
): string {
  const lines = rows.map(({ snap, sub }) => statusLine(snap, sub)).join("\n");
  const streaks = rows.filter(({ sub }) => sub.streak >= 2);
  const streakLine =
    streaks.length > 0
      ? `\n\nDon't break your streak — claiming today keeps it alive on-chain.`
      : "";
  const expiry =
    expiryWarnings.length > 0 ? `\n\n${expiryWarnings.join("\n")}` : "";
  return (
    `⏰ <b>Your daily G$ UBI is waiting!</b>\n\n${lines}${streakLine}${expiry}\n\n` +
    `👉 <a href="${CLAIM_URL}">Claim now on GoodDapp</a> before the day rolls over.`
  );
}

export function identityExpiryLine(
  wallet: string,
  daysLeft: number,
): string {
  return (
    `⚠️ <code>${shortAddress(wallet)}</code> — your face verification expires ` +
    `in <b>${daysLeft} day${daysLeft === 1 ? "" : "s"}</b>. Re-verify in the ` +
    `GoodWallet app to keep claiming.`
  );
}

export function poolStatsMessage(stats: PoolStats): string {
  const rollover = new Date((stats.dayStart + 86_400) * 1000);
  const hh = String(rollover.getUTCHours()).padStart(2, "0");
  const mm = String(rollover.getUTCMinutes()).padStart(2, "0");
  return (
    `📊 <b>GoodDollar UBI pool — live on Celo</b>\n\n` +
    `🌍 Claimers today: <b>${stats.claimersToday.toLocaleString()}</b>\n` +
    `💸 Distributed today: <b>${stats.distributedTodayGs} G$</b>\n` +
    `🎁 Today's claim: <b>${stats.dailyUbiGs} G$</b> per person\n` +
    `📅 UBI day: <b>#${stats.currentDay}</b> (rolls over ${hh}:${mm} UTC)\n\n` +
    `Every number above is read straight from the UBIScheme contract.`
  );
}

export function streakMessage(subs: Subscriber[]): string {
  if (subs.length === 0) {
    return "No wallets yet — send me a Celo address to start tracking your claim streak.";
  }
  const lines = subs
    .map((s) => {
      const badge = streakBadge(s.streak) || "▫️";
      return (
        `${badge} <code>${shortAddress(s.wallet)}</code> — ` +
        `<b>${s.streak}-day</b> streak (best: ${s.bestStreak})`
      );
    })
    .join("\n");
  return (
    `🔥 <b>Your claim streaks</b>\n\n${lines}\n\n` +
    `Streaks count consecutive UBI days with an on-chain claim.`
  );
}

export function leaderboardMessage(rows: LeaderboardRow[]): string {
  if (rows.length === 0) {
    return "No streaks on the board yet. Claim today to start yours!";
  }
  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows
    .map((r, i) => {
      const rank = medals[i] ?? ` ${i + 1}.`;
      return `${rank} <code>${shortAddress(r.wallet)}</code> — <b>${r.streak} days</b> (best ${r.bestStreak})`;
    })
    .join("\n");
  return `🏆 <b>Streak leaderboard</b>\n\n${lines}\n\nClaim daily to climb the board.`;
}
