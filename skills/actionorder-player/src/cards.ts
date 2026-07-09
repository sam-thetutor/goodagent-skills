/**
 * ACTION-ORDER game data, extracted from the live client. A card has a type in
 * a rock-paper-scissors cycle plus a priority (tie-breaker) and knock (damage).
 *
 * Type cycle (winner deals full knock, loser deals 30%):
 *   strike  beats control
 *   control beats defense
 *   defense beats strike
 */

export type CardType = "strike" | "defense" | "control";

export interface Card {
  id: string;
  type: CardType;
  priority: number;
  knock: number;
  energyCost: number;
  /** Premium cards are bought in the in-game Black Market; a fresh agent
   *  wallet does not own them, so the default deck excludes them. */
  premium: boolean;
}

/** What each type beats. */
export const BEATS: Record<CardType, CardType> = {
  strike: "control",
  control: "defense",
  defense: "strike",
};

/** The full card catalog (base + premium). */
export const CARDS: Card[] = [
  { id: "phantom_break", type: "strike", priority: 2, knock: 6, energyCost: 2, premium: false },
  { id: "storm_kick", type: "strike", priority: 3, knock: 5, energyCost: 2, premium: false },
  { id: "power_punch", type: "strike", priority: 1, knock: 8, energyCost: 3, premium: false },
  { id: "direct_impact", type: "strike", priority: 4, knock: 4, energyCost: 1, premium: false },
  { id: "finisher", type: "strike", priority: 1, knock: 3, energyCost: 4, premium: false },
  { id: "guard_stance", type: "defense", priority: 2, knock: 2, energyCost: 1, premium: false },
  { id: "stability", type: "defense", priority: 1, knock: 1, energyCost: 1, premium: false },
  { id: "reversal_edge", type: "defense", priority: 3, knock: 3, energyCost: 3, premium: false },
  { id: "anticipation", type: "defense", priority: 5, knock: 3, energyCost: 1, premium: false },
  { id: "mind_game", type: "control", priority: 4, knock: 3, energyCost: 2, premium: false },
  { id: "evasion", type: "control", priority: 5, knock: 2, energyCost: 1, premium: false },
  { id: "pressure_advance", type: "control", priority: 3, knock: 5, energyCost: 2, premium: false },
  { id: "disrupt", type: "control", priority: 2, knock: 4, energyCost: 2, premium: false },
  { id: "berserk_surge", type: "strike", priority: 1, knock: 9, energyCost: 3, premium: false },
  { id: "run_away", type: "control", priority: 5, knock: 2, energyCost: 1, premium: false },
  { id: "inner_focus", type: "control", priority: 3, knock: 6, energyCost: 2, premium: false },
  { id: "javelin_dive", type: "strike", priority: 2, knock: 5, energyCost: 2, premium: false },
  { id: "aerial_spear_fist", type: "strike", priority: 2, knock: 8, energyCost: 3, premium: false },
  // Premium (Black Market) — excluded from the default deck.
  { id: "rko", type: "strike", priority: 7, knock: 11, energyCost: 4, premium: true },
  { id: "go_to_hell", type: "strike", priority: 3, knock: 15, energyCost: 5, premium: true },
  { id: "headbutt", type: "strike", priority: 8, knock: 7, energyCost: 3, premium: true },
  { id: "fire", type: "strike", priority: 4, knock: 9, energyCost: 4, premium: true },
  { id: "jaw_breaker", type: "strike", priority: 4, knock: 10, energyCost: 4, premium: true },
  { id: "lightning", type: "strike", priority: 8, knock: 7, energyCost: 4, premium: true },
  { id: "bite", type: "strike", priority: 6, knock: 3, energyCost: 1, premium: true },
  { id: "halo_knee_jab", type: "strike", priority: 7, knock: 7, energyCost: 3, premium: true },
  { id: "gravity_well", type: "control", priority: 3, knock: 7, energyCost: 3, premium: true },
  { id: "shadow_bind", type: "control", priority: 7, knock: 6, energyCost: 3, premium: true },
  { id: "grab", type: "control", priority: 6, knock: 4, energyCost: 2, premium: true },
  { id: "cage", type: "control", priority: 5, knock: 5, energyCost: 3, premium: true },
  { id: "no_drain", type: "control", priority: 5, knock: 4, energyCost: 1, premium: true },
  { id: "darkness_repellent", type: "defense", priority: 7, knock: 0, energyCost: 3, premium: true },
  { id: "ethereal_form", type: "defense", priority: 7, knock: 3, energyCost: 2, premium: true },
  { id: "halo_shield", type: "defense", priority: 6, knock: 3, energyCost: 1, premium: true },
  { id: "downslide", type: "defense", priority: 6, knock: 3, energyCost: 2, premium: true },
];

export interface Character {
  id: string;
  name: string;
  className: string;
  knockStat: number;
  priorityStat: number;
  drainStat: number;
}

/** The five unlocked starter characters. */
export const CHARACTERS: Character[] = [
  { id: "kaira", name: "KAIRA", className: "Vanguard", knockStat: 85, priorityStat: 62, drainStat: 40 },
  { id: "kenji", name: "KENJI", className: "Ronin", knockStat: 78, priorityStat: 80, drainStat: 55 },
  { id: "riven", name: "RIVEN", className: "Shadow", knockStat: 70, priorityStat: 90, drainStat: 50 },
  { id: "zane", name: "ZANE", className: "Brawler", knockStat: 95, priorityStat: 45, drainStat: 35 },
  { id: "elara", name: "ELARA", className: "Void Witch", knockStat: 60, priorityStat: 75, drainStat: 90 },
];

/** Energy budget for an order, derived from a character's drain stat. */
export function energyBudget(c: Character): number {
  return Math.max(10, Math.round(7 + (c.drainStat / 100) * 6));
}

/** Damage multiplier applied to every knock a character deals. */
export function knockMultiplier(c: Character): number {
  return c.knockStat / 75;
}

export function getCard(id: string): Card {
  const card = CARDS.find((c) => c.id === id);
  if (!card) throw new Error(`unknown card id: ${id}`);
  return card;
}

export function getCharacter(id: string): Character {
  const c = CHARACTERS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown character id: ${id}`);
  return c;
}
