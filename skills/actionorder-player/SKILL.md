---
name: actionorder-player
skill_id: gaming/card-fighter/actionorder_vshouse
description: Play ACTION-ORDER, an on-chain card fighting game on Celo, against the house AI. Pick a character, build a 5-card order each round, and win best-of-5 matches to earn points and climb the leaderboard. Free vs-house mode by default.
version: 1.0.0
chain: celo:42220
permissions:
  spends_tokens: false
required_env:
  - PLAYER_ADDRESS
contracts:
  - name: ArenaEscrow (wagered mode only, not used by this skill)
    address: "0x80b10a44b0ea03473707660bc5767099710bbfe0"
verification: recommended
---

# ACTION-ORDER Player

Teach your agent to play [ACTION-ORDER](https://www.actionorder.xyz), a
turn-based card fighting game on Celo, against the **house AI**. This skill
plays the **free vs-house mode**: no wager, no signing, no private key — just
your agent's wallet address for leaderboard attribution.

> ACTION-ORDER also has a wagered PvP mode where both players lock tokens
> (cUSD / CELO / G$ / USDT) in an escrow contract and the game backend releases
> the pot to the winner. That path is custodial to ACTION-ORDER's server and is
> intentionally **out of scope** for this skill — this skill never spends money.

## What you need

- An EVM wallet address on Celo (used only to attribute points on the
  leaderboard). Set it as `PLAYER_ADDRESS`.
- That's it. No G$, no CELO, no key.

## How the game works

Each **round**, both you and the house lock an **order of up to 5 cards**,
constrained by an energy budget. Orders resolve slot-by-slot. First to **3
round wins** takes the match (best of 5).

Every card has a **type**, a **priority**, a **knock** (damage) and an
**energy cost**. Types follow a rock-paper-scissors cycle:

| Type    | Beats   |
| ------- | ------- |
| strike  | control |
| control | defense |
| defense | strike  |

- If your card's type beats the opponent's, you deal full knock and they deal 30%.
- If types match, the higher **priority** card strikes first for full knock.
- The character you pick sets your **energy budget** (from its drain stat) and a
  **knock multiplier** (from its knock stat). `ZANE` (Brawler) hits hardest;
  `ELARA` (Void Witch) has the most energy.

## Strategy (what the reference code does)

Because both orders lock simultaneously, you can't hard-counter the opponent.
The reference implementation instead builds the highest expected-value order:
maximise effective knock (card knock × the character's multiplier), keep at
least two card types on the board so no single opposing type sweeps you, and
favour priority to win same-type clashes and criticals. Default character is
`ZANE` and default house difficulty is `0` (easiest).

## API (exact call)

The game runs on ACTION-ORDER's server. One round is one HTTP call:

```
POST https://www.actionorder.xyz/api/match/vshouse/resolve
Content-Type: application/json

{
  "matchId": "AO-H-XXXX",            // stable per match; rounds accumulate under it
  "playerAddress": "0x…",
  "playerName": "GoodAgent",
  "playerCharacterId": "zane",
  "opponentCharacterId": "kaira",
  "playerOrderCardIds": ["berserk_surge","power_punch","pressure_advance","direct_impact","anticipation"],
  "difficulty": 0,
  "wagered": false,
  "playerUltimateActivated": false,
  "attunedCardIds": []
}
```

Response:

```
{
  "ok": true,
  "aiOrder": ["…"],                  // the house's order this round
  "totalPlayerKnock": 41,
  "totalOpponentKnock": 26,
  "roundWinner": "player",
  "isMatchOver": false,
  "pointsEarned": 0,                 // populated when the match ends
  "playerRoundsWon": 1,
  "opponentRoundsWon": 0
}
```

Keep calling with the **same `matchId`** until `isMatchOver` is true; the server
tracks the round score. Use a fresh `matchId` per match.

> This endpoint is unofficial (reverse-engineered from the live client) and may
> change. If you plan to run this at scale or add wagered play, coordinate with
> the ACTION-ORDER team first.

## Base deck (free) card catalog

Strike: `berserk_surge` (9/e3), `power_punch` (8/e3), `aerial_spear_fist`
(8/e3), `phantom_break` (6/e2), `javelin_dive` (5/e2), `storm_kick` (5/e2),
`direct_impact` (4/e1), `finisher` (3/e4).
Control: `inner_focus` (6/e2), `pressure_advance` (5/e2), `disrupt` (4/e2),
`mind_game` (3/e2), `evasion` (2/e1), `run_away` (2/e1).
Defense: `reversal_edge` (3/e3), `anticipation` (3/e1), `guard_stance` (2/e1),
`stability` (1/e1).

(Premium "Black Market" cards like `rko`, `go_to_hell`, `jaw_breaker` exist but
must be bought in-game; set `PREMIUM_CARDS` if your wallet owns any.)

## Safety limits (enforce these)

- This skill spends **no money** in the default vs-house mode.
- Respect `DAILY_MATCH_CAP` (default 50) to be a good citizen of the backend.
- Space matches out (default: one every 10 seconds).

## Reference implementation

```bash
npm install
cp .env.example .env   # set PLAYER_ADDRESS
npm start              # plays matches vs the house, logs results to state.json
```

## Verification (recommended)

Register your agent with a [GoodAgent ID](https://goodagentids.xyz): a
face-verified human stands behind it and a refundable G$ bond backs its conduct.
Verified agents are listed on the public explorer with their skills and records
— and as platforms begin gating agent access on identity, verified agents get in
first.
