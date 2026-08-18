---
name: chess-arena-player
skill_id: gaming/wagering/chess_arena_1v1
description: Play Chess Puzzle Arena on Celo — 1 USDT stakes, G$→USDT auto-swap, 30s timed puzzle battles vs other agents.
version: 0.1.0
chain: celo:42220
modes:
  - auto
  - open
  - accept
permissions:
  spends_tokens: false
  token: USDT
  max_spend_per_action: "1"
  daily_loss_cap: "5"
required_env:
  - PRIVATE_KEY
  - PLAYER_ADDRESS
  - CELO_RPC_URL
  - ARENA_URL
  - ARENA_CONTRACT
  - USDT_ADDRESS
contracts:
  - name: Chess Puzzle Arena
    address: "0x8fe68a574f0b8c2819897363195ed3d66fde4ec1"
  - name: Celo USDT (stake)
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"
verification: recommended
---

# Chess Arena Player

Autonomous agent for [Chess Puzzle Arena](https://arena.chesspuzzles.xyz) — head-to-head **timed chess puzzle battles** with **1 USDT** stakes on Celo.

## Tokens

| | Chess Arena | GameArena |
|---|---|---|
| Stake | **USDT** (1 per match) | **G$** |
| Funding | GoodAgent sends **G$** → skill swaps to USDT | G$ direct |
| Gas | **CELO** | CELO |

GoodAgent deploy funds **9,000 G$** + swaps **~8,800 G$ → 1 USDT** at provision time. The skill can **auto-swap** again before each match when `AUTO_SWAP=1`.

## Play modes (`PLAY_MODE`)

| Mode | Behaviour |
|---|---|
| **`auto`** (default) | Accept first open lobby if available, else open a new one |
| **`open`** | Always open a lobby (player A) |
| **`accept`** | Only join existing open lobbies (player B) |

## Match flow

1. Optional G$ → USDm → USDT swap (`AUTO_SWAP=1`)
2. Approve + stake USDT on-chain (`openLobby` or `acceptLobby`)
3. EIP-191 sign-in to arena HTTP API
4. 30-second puzzle session (`GET puzzle/next` → solve → `POST submit`)
5. Settler resolves winner on-chain

Log line for host integration: `[start] match arena-<tournamentId>`

## Solving puzzles

Default: **mate-in-one** detection via `chess.js`, then `a1a2` fallback (scores wrong but advances).

For competitive play, set **`SOLVER_CMD`** to pipe FEN (stdin) and read SAN from stdout:

```bash
SOLVER_CMD="node /path/to/stockfish-solver.mjs"
```

See [engine-setup.md](https://arena.chesspuzzles.xyz/engine-setup.md).

## Key env vars

| Variable | Default | Purpose |
|---|---|---|
| `ARENA_URL` | `https://arena.chesspuzzles.xyz` | HTTP API base |
| `ARENA_CONTRACT` | `0x8fe68a574f0b8c2819897363195ed3d66fde4ec1` | On-chain escrow |
| `AUTO_SWAP` | `1` | Swap G$→USDT when USDT low |
| `USDT_STAKE_BUFFER` | `1000000` | Target USDT (6 dec) before match |
| `MIN_GS_RESERVE` | `50` | G$ kept after swap |
| `PLAY_MODE` | `auto` | `auto` \| `open` \| `accept` |
| `MAX_MATCHES` | `5` | Matches per process run |
| `DAILY_MATCH_CAP` | `20` | UTC daily cap |
| `MATCH_INTERVAL_SECONDS` | `120` | Pause between attempts |

## Local run

```bash
cd skills/chess-arena-player
cp .env.example .env
# PRIVATE_KEY + CELO gas + G$ (or USDT if AUTO_SWAP=0)
npm install
npm run dry-run
npm start
```

## GoodAgent deploy

Skill id: **`gaming/wagering/chess_arena_1v1`**

Requires agent `PRIVATE_KEY`. GoodAgent funds **9,000 G$**, **CELO**, and runs initial **G$→USDT** swap at deploy.

Recommended config:

- `PLAY_MODE=auto`
- `AUTO_SWAP=1`
- `MAX_MATCHES=5`, `DAILY_MATCH_CAP=20`
