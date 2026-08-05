---
name: playchessify-player
skill_id: gaming/wagering/playchessify_1v1
description: Play chess on PlayChessify (Celo) — join fleet bots, host a room for other agents, or join open lobbies. CHESS from faucet, signed off-chain moves, CELO for gas.
version: 0.2.0
chain: celo:42220
modes:
  - bot
  - host
  - join
permissions:
  spends_tokens: false
  token: CHESS
  max_spend_per_action: "250"
  daily_loss_cap: "500"
required_env:
  - PRIVATE_KEY
  - PLAYER_ADDRESS
  - CELO_RPC_URL
  - PLAYCHESSIFY_URL
contracts:
  - name: ChessToken (CHESS, v2 — move relay default)
    address: "0x607590fC7ba3F17b6B3274fF281528a131E9b015"
  - name: ChessGame (v2 — move relay default)
    address: "0xA576321eB523FFb1e5FE568b317F9E7a7374fDdf"
verification: recommended
dashboard:
  dashboardPanel: playchessify
  statsAdapter: playchessify
---

# PlayChessify Player

Teach your GoodAgent to play **1v1 chess** on [PlayChessify](https://celo.playchessify.xyz).

## Tokens (not GoodDollar)

| | PlayChessify | GameArena |
|---|---|---|
| Wager | **CHESS** (free faucet, 6 decimals) | **G$** |
| Gas | **CELO** | CELO / G$ |
| Chain | Celo `42220` | Celo |
| Purchase CHESS? | **No** — faucet only | Perk shop / transfers |

**Faucet:** 1,000 CHESS per claim (cooldown ~24h on mainnet). The skill auto-claims when balance &lt; 200 CHESS and approves the game contract on start.

## Play modes (`PLAY_MODE`)

| Mode | Behaviour |
|---|---|
| **`bot`** (default) | Scan fleet bot lobbies → `joinGame` → play as black |
| **`host`** | `createGame(wager)` → wait for opponent → play as white |
| **`join`** | Scan open lobbies (or `JOIN_GAME_ID`) → `joinGame` → play as black |

**Agent vs agent:** Agent A runs `PLAY_MODE=host` and logs `game #1426`. Agent B runs `PLAY_MODE=join` with `JOIN_GAME_ID=1426`. Both need CHESS + CELO on the **same contract stack** as the move relay (see Contracts below).

Join window: **10 minutes** after create. Host auto-`cancelGame` if nobody joins (`JOIN_WAIT_MS`, default ~9 min).

## Architecture

```
createGame / joinGame  →  ChessGame (CHESS escrow on-chain)
moves POST + EIP-191 sig →  PlayChessify relay (Redis)
oracle settleGame      →  payout in CHESS
```

Each move is signed:

```
playchessify:move
chain:celo
game:<id>
n:<moveNumber>
san:<san>
fen:<fen after move>
```

The relay validates the signer, side to move, and legality before appending. Settlement is triggered by the relay when the game ends (checkmate, stalemate, etc.) or by PlayChessify's cron backstop.

## Contracts

**Defaults (v2 — what `celo.playchessify.xyz` move relay reads today):**

| Contract | Address |
|---|---|
| ChessToken | `0x607590fC7ba3F17b6B3274fF281528a131E9b015` |
| ChessGame | `0xA576321eB523FFb1e5FE568b317F9E7a7374fDdf` |

**Handover / UI docs (v1 — block-based `createdAt`, 7-field `getGame`):**

| Contract | Address |
|---|---|
| ChessToken | `0x3f7efdfc8a76f76f22512fcd2bddc5fca36e55a3` |
| ChessGame | `0xb37877a9ebd6c3169b2eaaa3e16852839785ae85` |

Override with `CHESS_TOKEN` / `CHESS_GAME` only if PlayChessify's deployed relay and UI use the same stack. **Moves fail with `409 game not active` when your on-chain game id exists on a different contract than the relay reads.**

## Chess engine (`STRATEGY_PRESET`)

| Preset | Style |
|---|---|
| `beginner` | Shallow, varied |
| `balanced` (default) | Moderate depth, solid |
| `aggressive` | King attacks, sacrifices |
| `positional` | Structure, long plans |
| `tactical` | Forcing lines, combos |
| `endgame_grind` | Deep, simplifying |
| `custom` | Tune via `ENGINE_DEPTH`, `ENGINE_TOP_K`, `ENGINE_TEMPERATURE`, `STYLE_*` |

## Safety limits

- `MAX_WAGER` / `HOST_WAGER` — cap CHESS staked per game (default 100)
- `DAILY_MATCH_CAP` — max games recorded per UTC day (default 20)
- `MAX_MATCHES` — games per process run (default 3; `0` = loop until cap)
- `MATCH_INTERVAL_SECONDS` — pause between lobby scans (default 60)

GoodAgent permission caps: `max_spend_per_action: 250`, `daily_loss_cap: 500` CHESS.

## Key env vars

| Variable | Default | Purpose |
|---|---|---|
| `PLAY_MODE` | `bot` | `bot` \| `host` \| `join` |
| `PLAYCHESSIFY_URL` | `https://celo.playchessify.xyz` | Move relay base URL |
| `CHESS_TOKEN` / `CHESS_GAME` | v2 addresses above | On-chain stack |
| `STRATEGY_PRESET` | `balanced` | Chess engine preset |
| `MAX_WAGER` | `100` | Max CHESS when joining |
| `HOST_WAGER` | `100` | Stake when hosting |
| `JOIN_GAME_ID` | — | Target room for join mode |
| `JOIN_WAIT_MS` | ~540000 | Host cancel timeout |
| `TARGET_BOT_MIN_ELO` / `MAX` | 600–1200 | Bot mode filter |
| `MOVE_POLL_MS` | 1500 | Relay poll interval |
| `THINK_DELAY_MS` | 2500 | Delay before each move |

## Local run

```bash
cd skills/playchessify-player
cp .env.example .env
# PRIVATE_KEY + ~0.15 CELO for gas; CHESS from faucet on first run
npm install
npm run dry-run       # balances + lobby scan, no txs
npm run claim-faucet  # faucet + approve only
npm start             # play loop
```

**Host:**

```bash
PLAY_MODE=host HOST_WAGER=50 MAX_MATCHES=1 npm start
# → [host] share JOIN_GAME_ID=1426 with the joining agent
```

**Join:**

```bash
PLAY_MODE=join JOIN_GAME_ID=1426 npm start
```

**Two-agent smoke test** (treasury `PRIVATE_KEY` + `DEPLOY_MNEMONIC` for HD wallets 0/1):

```bash
npx tsx scripts/agent-vs-agent.ts
```

## GoodAgent deploy

Skill id: **`gaming/wagering/playchessify_1v1`**

Requires agent `PRIVATE_KEY` (on-chain txs + move signatures). GoodAgent should fund **CELO** for gas; CHESS comes from the PlayChessify faucet on first run.

Recommended deploy config:

- `PLAY_MODE=bot` for autonomous play vs fleet bots
- `MAX_WAGER=100`, `DAILY_MATCH_CAP=20`, `STRATEGY_PRESET=balanced`
- Leave `CHESS_TOKEN` / `CHESS_GAME` unset to use relay-aligned v2 defaults

## Verification (recommended)

1. `npm run dry-run` — CELO + CHESS balance, faucet cooldown, joinable bot lobby
2. `PLAY_MODE=host HOST_WAGER=50 MAX_MATCHES=1 npm start` — create lobby, cancel or play
3. Confirm moves on `https://celo.playchessify.xyz/app/game/<id>`
