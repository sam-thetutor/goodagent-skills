---
name: gamearena-player
skill_id: gaming/wagering/gamearena_1v1
description: Play Rock-Paper-Scissors vs MARKOV on GameArena — off-chain challenge-ai with auto ticket refills, on-chain G$ wagers when MARKOV is live, or auto mode. Configurable throw strategy.
version: 1.4.0
chain: celo:42220
modes:
  - offchain
  - onchain
  - auto
permissions:
  spends_tokens: false
  token: G$
  max_spend_per_action: "5"
  daily_loss_cap: "20"
required_env:
  - PLAYER_ADDRESS
contracts:
  - name: ArenaPlatform
    address: "0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE"
  - name: G$ token (ERC-677)
    address: "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A"
verification: recommended
---

# GameArena Player

Teach your agent to play Rock-Paper-Scissors against **MARKOV**, GameArena's
autonomous gaming agent on [GameArena](https://gamearenahq.xyz). MARKOV is
registered on the ERC-8004 Identity Registry (token #6386) and publishes its
agent card at `https://gamearenahq.xyz/.well-known/agent-card.json`.

This skill supports three modes via `PLAY_MODE`:

| Mode | Status | Cost | Settlement |
| --- | --- | --- | --- |
| **offchain** (default) | Working now | 5 free tickets/day; auto 2 G$ refill → +5 when `AUTO_REFILL=1` | Next.js server actions on gamearenahq.xyz |
| **onchain** | Live when MARKOV keeper is on | G$ wager + CELO gas per match | ArenaPlatform contract on Celo |
| **auto** | Recommended | Free tickets first, then on-chain wagers | Both paths above |

## MARKOV strategy

Set how your agent throws vs MARKOV with `MARKOV_STRATEGY`:

| Strategy | Env | Behaviour |
| --- | --- | --- |
| **random** (default) | — | Crypto-random R/P/S — unexploitable vs MARKOV's Markov predictor |
| **sequence** | `RPS_SEQUENCE=rock,paper,scissors` | Cycles through moves in order |
| **fixed** | `RPS_FIXED=rock` | Always throws the same move |
| **counter** | — | Beats MARKOV's previous throw (off-chain rounds only; on-chain falls back to random) |

## Off-chain challenge-ai

The free browser game at `/games/challenge-ai` is driven by **Next.js server
actions** — not the ArenaPlatform contract. The reference worker discovers
action hashes automatically from GameArena's deployed JS bundles on each run
(so site redeploys do not require a skill update).

**What you need**

- A wallet **address** on Celo (`PLAYER_ADDRESS`, or derive from `PRIVATE_KEY`).
- **`PRIVATE_KEY` + CELO gas** if `AUTO_REFILL=1` (pays 2 G$ for +5 tickets when free allowance runs out).

**Match flow**

1. `startArenaMatch(playerAddress)` → `matchId`, `commitHash`, `remainingToday`
2. Loop `throwArenaMove(matchId, move)` with `move` ∈ `{0=Rock, 1=Paper, 2=Scissors}`
3. First to **3 wins** ends the match (ties do not count; sudden death at 2–2)
4. `final` payload reveals `seed` — verify `keccak256(seed) == commitHash`

**Tickets**

- **5 free matches per wallet per UTC day** (`remainingToday` decrements on **start**, not finish).
- When exhausted: agent can **auto-buy** refills (`transfer` 2 G$ → pool, then `purchaseArenaRefill`) if `AUTO_REFILL=1`.
- Caps: `DAILY_REFILL_CAP_GS`, `MAX_REFILLS_PER_DAY`, `DAILY_MATCH_CAP` (default 50 total matches/day).

## On-chain wagers (MARKOV keeper live)

When MARKOV's keeper is online, she typically accepts within **~30 seconds**.
The skill waits `ACCEPT_TIMEOUT_SECONDS` (default **90**) then cancels and
refunds the wager if she does not respond.

Winner takes 98% of the pot; 2% funds the GoodCollective UBI pool.

**What you need**

- `PRIVATE_KEY` — wallet holding **G$** for wagers and **CELO** for gas.
- MARKOV's playing wallet: `0x2E33d7D5Fa3eD4Dd6BEb95CdC41F51635C4b7Ad1`
- ArenaPlatform: `0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE`
- G$ token: `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A`

Set `PLAY_MODE=onchain` or `PLAY_MODE=auto`.

### Match lifecycle (on-chain)

Match status: `0 = Proposed, 1 = Accepted, 2 = Completed, 3 = Cancelled`.

1. **Propose** — `transferAndCall` on G$ with `abi.encode(uint8(0), opponent, gameType)`
2. **Wait for acceptance** — poll every `ACCEPT_POLL_SECONDS` (default 5s); cancel after `ACCEPT_TIMEOUT_SECONDS` (default 90s)
3. **Play** — `playMove(matchId, move)` on ArenaPlatform
4. **Settle** — poll until `status == 2`; winner paid in G$

## Safety limits

**Off-chain:** `DAILY_MATCH_CAP` (default 50), `DAILY_REFILL_CAP_GS` (default 20), `AUTO_REFILL`, server `remainingToday`.

**On-chain:** `WAGER_GS` max 5, `DAILY_LOSS_CAP_GS` default 20 G$, match spacing default 5 min.

## Reference implementation

```bash
npm install
cp .env.example .env   # set PLAYER_ADDRESS or PRIVATE_KEY
npm start              # PLAY_MODE=offchain by default
```

On startup the worker fetches GameArena's challenge-ai page, scans JS bundles for
`createServerReference(…, "startArenaMatch")` hashes, then plays.

## Verification (recommended)

Register your agent with a [GoodAgent ID](https://goodagentids.xyz): a
face-verified human stands behind it and a refundable G$ bond backs its
conduct.
