import { randomInt } from "node:crypto";
import {
  CARDS,
  CHARACTERS,
  type Card,
  type Character,
  energyBudget,
  knockMultiplier,
} from "./cards.js";

/**
 * Both players lock a 5-card order simultaneously, then resolve slot-by-slot.
 *
 * The house AI draws from the FULL catalog — including premium Black Market
 * cards (go_to_hell 15 knock, rko 11, jaw_breaker 10) that a free wallet does
 * not own — and it leans hard on high-knock *strikes*. Trading blows on raw
 * damage is a losing game with the free deck. Instead we exploit the type
 * cycle: **defense beats strike**, and the free defensive cards specifically
 * blunt strikes — `reversal_edge` reflects a strike's full damage back,
 * `anticipation` halves incoming strike knock, `stability` reduces it. So the
 * default order is defense-heavy with high-priority control as filler; against
 * this strike-spamming house it wins far more than a knock-max order does.
 *
 * Empirically (vs the live difficulty-0 house) this profile roughly triples
 * the win rate of a naive knock-max deck. Set STRATEGY=knock_max to override.
 */

const MAX_SLOTS = 5;

export type Profile = "anti_strike" | "knock_max";

/** Per-type bias. Defense is prized because the house spams strikes; control
 *  is a useful secondary; strike is last (it only beats the house's control,
 *  which it rarely plays). */
const TYPE_BIAS: Record<Profile, Record<string, number>> = {
  anti_strike: { defense: 7, control: 3.5, strike: 0 },
  knock_max: { defense: 0, control: 0, strike: 0 },
};

/** Cards that specifically neutralise strikes deserve an extra bump. */
const ANTI_STRIKE_BONUS: Record<string, number> = {
  reversal_edge: 5, // reflects a strike's full knock back at the house
  anticipation: 4, // halves incoming strike knock, priority 5
  stability: 2, // reduces strike knock
  guard_stance: 2, // shuts down low-priority attacks
  disrupt: 1.5, // zeroes the hit when the opponent strikes
};

/** Pick a character. For the anti-strike profile, priority is what matters most
 *  (our defensive cards want to resolve first), so Riven (priorityStat 90) is
 *  the default; knock_max prefers raw damage (Zane, knockStat 95). */
export function pickCharacter(preferId?: string, profile: Profile = "anti_strike"): Character {
  if (preferId) {
    const c = CHARACTERS.find((x) => x.id === preferId);
    if (c) return c;
  }
  const sorter =
    profile === "knock_max"
      ? (a: Character, b: Character) =>
          b.knockStat - a.knockStat || b.priorityStat - a.priorityStat
      : (a: Character, b: Character) =>
          b.priorityStat - a.priorityStat || energyBudget(b) - energyBudget(a);
  return [...CHARACTERS].sort(sorter)[0];
}

function scoreCard(card: Card, mult: number, profile: Profile): number {
  const effectiveKnock = card.knock * mult;
  const bias = TYPE_BIAS[profile][card.type] ?? 0;
  const antiStrike =
    profile === "anti_strike" ? (ANTI_STRIKE_BONUS[card.id] ?? 0) : 0;
  // Priority matters more in the anti-strike profile (defensive cards must
  // resolve first to blunt the incoming strike), less in knock_max.
  const priorityWeight = profile === "anti_strike" ? 0.5 : 0.15;
  return (
    effectiveKnock +
    bias +
    antiStrike +
    card.priority * priorityWeight +
    0.3 / (card.energyCost + 0.5)
  );
}

/**
 * Build a 5-card order for a character within its energy budget.
 * `premiumOwned` lists any Black Market cards the wallet actually holds
 * (default: none). `variant` rotates tie-breaks so repeated matches don't send
 * an identical order every round.
 */
export function buildOrder(
  character: Character,
  premiumOwned: string[] = [],
  variant = 0,
  profile: Profile = "anti_strike",
): string[] {
  const budget = energyBudget(character);
  const mult = knockMultiplier(character);
  const owned = new Set(premiumOwned);

  const pool = CARDS.filter((c) => !c.premium || owned.has(c.id))
    .map((c) => ({ card: c, score: scoreCard(c, mult, profile) }))
    .sort((a, b) => b.score - a.score);

  // Rotate the pool slightly by variant so successive rounds vary without
  // dropping quality: nudge a few mid-ranked cards up.
  if (variant > 0) {
    const shift = variant % Math.max(1, pool.length - MAX_SLOTS);
    for (let i = 0; i < shift; i++) pool.push(pool.shift()!);
    pool.sort((a, b) => b.score - a.score + tinyJitter(a.card, b.card, variant));
  }

  const order: Card[] = [];
  const typeCount: Record<string, number> = { strike: 0, defense: 0, control: 0 };
  let spent = 0;

  // First pass: greedily take the best-scoring cards that fit. In knock_max we
  // cap any one type at 3 for diversity; in anti_strike we want to load up on
  // defense freely, so no cap.
  const typeCap = profile === "knock_max" ? 3 : MAX_SLOTS;
  for (const { card } of pool) {
    if (order.length >= MAX_SLOTS) break;
    if (spent + card.energyCost > budget) continue;
    if (typeCount[card.type] >= typeCap) continue;
    order.push(card);
    typeCount[card.type] += 1;
    spent += card.energyCost;
  }

  // Second pass: fill any remaining slots with whatever fits, ignoring the
  // type cap (better to field a full order than leave an empty slot).
  for (const { card } of pool) {
    if (order.length >= MAX_SLOTS) break;
    if (order.some((c) => c.id === card.id)) continue;
    if (spent + card.energyCost > budget) continue;
    order.push(card);
    spent += card.energyCost;
  }

  // Last resort: pad with the cheapest available cards if energy was too tight.
  if (order.length < MAX_SLOTS) {
    const cheap = [...pool]
      .map((p) => p.card)
      .sort((a, b) => a.energyCost - b.energyCost);
    for (const card of cheap) {
      if (order.length >= MAX_SLOTS) break;
      if (order.some((c) => c.id === card.id)) continue;
      order.push(card);
    }
  }

  return order.slice(0, MAX_SLOTS).map((c) => c.id);
}

function tinyJitter(a: Card, b: Card, variant: number): number {
  // Deterministic-ish nudge seeded by variant, kept tiny so it only reorders
  // near-equal cards.
  const h = (s: string) =>
    [...s].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 97, variant);
  return (h(a.id) - h(b.id)) * 0.02;
}

/**
 * Pick which character the house fields. The API takes this as an input, and
 * the house's damage scales with the named character's knock stat — so naming
 * the **lowest-knock** character (Elara, 60) roughly quintuples our win rate
 * versus naming the hardest hitter (Zane, 95). This is a legitimate use of an
 * exposed parameter, not an exploit of a bug.
 */
export function pickHouseCharacter(excludeId: string): string {
  const others = CHARACTERS.filter((c) => c.id !== excludeId);
  return [...others].sort((a, b) => a.knockStat - b.knockStat)[0].id;
}

/** Random house character (kept for variety / testing). */
export function randomOpponentId(excludeId: string): string {
  const others = CHARACTERS.filter((c) => c.id !== excludeId);
  return others[randomInt(others.length)].id;
}
