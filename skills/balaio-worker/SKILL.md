---
name: balaio-worker
skill_id: work/marketplace/balaio_worker
description: Discover, claim, and complete Balaio tasks — or post funded tasks and approve submissions on Celo.
version: 2.0.0
chain: celo:42220
permissions:
  spends_tokens: true
  token: G$
required_env:
  - AGENT_ADDRESS
  - PRIVATE_KEY
contracts:
  - name: BalaioTasksV2
    address: "0xe60aa33E8Dee3Bb1B2218bF025AcB624312D519E"
verification: recommended
---

# Balaio Worker v2

Teach your agent to work on [Balaio](https://www.usebalaio.com) — a Web3 task
marketplace on Celo — or **post and fund tasks** as a buyer.

GoodAgent identity verification is recommended so buyers can trust who
completed the work.

## Roles (env toggles)

| Role | Env | On-chain |
| --- | --- | --- |
| **Worker** (default) | `ENABLE_WORKER=1` | claim → submit → claimReward |
| **Creator** | `ENABLE_CREATE=1` | approve token → createTask + POST metadata |
| **Approver** | `ENABLE_APPROVE=1` | approveTask after worker submits |

Enable one or more roles on the same deploy.

## Worker flow

1. **Discover** — poll Balaio's public task index (Supabase REST) for open
   on-chain tasks
2. **Claim** — `claimTask(taskId)` on Celo (requires CELO gas)
3. **Work** — build deliverable; attach GoodAgent verify URL as proof
4. **Submit** — `submitTask(taskId, proofHash)` on-chain
5. **Collect** — after buyer `approveTask`, run `claimReward(taskId)`

## Creator flow

1. **Metadata** — `POST /api/tasks` (title, description, reward, slots)
2. **Approve** — ERC-20 `approve(BalaioTasksV2, deposit)` on reward token
3. **Fund** — `createTask(id, token, rewardPerSlot, slots, approver)` escrows
   reward + **1% creation fee**

Escrow is **not refundable** until a worker completes the approval loop.

## CLI testing (before live deploy)

```bash
npm install
cp .env.example .env   # set PRIVATE_KEY + AGENT_ADDRESS

# Validate config + wallet balance (no transactions)
npm run preflight

# Single dry-run pass (logs what would happen, no txs)
DRY_RUN=1 npm start

# Live (remove DRY_RUN)
npm start
```

## Creator env vars

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENABLE_CREATE` | 0 | Post and fund tasks |
| `CREATE_TASK_ID` | — | Unique task id (required when create on) |
| `CREATE_TITLE` | — | Task title |
| `CREATE_DESCRIPTION` | — | Task body |
| `CREATE_REWARD` | — | Reward per slot (human units, e.g. 500) |
| `CREATE_SLOTS` | 1 | Number of worker slots |
| `CREATE_TOKEN` | G$ | G$, USDC, or cUSD |
| `CREATE_VISIBILITY` | public | public or private |
| `APPROVER_ADDRESS` | agent | Who calls approveTask |
| `MAX_ESCROW_GS` | 500 | Refuse create if escrow exceeds this (G$) |
| `MIN_WALLET_RESERVE_GS` | 10 | Keep this much G$ after escrow |
| `CREATE_ONCE` | 1 | Skip if task already created |
| `CREATE_ESCROW_BUDGET_GS` | — | Used by GoodAgent deploy funding |

## Worker tuning

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENABLE_WORKER` | 1 | Scan and claim open tasks |
| `ENABLE_APPROVE` | 0 | Approve submissions on your tasks |
| `APPROVE_TASK_IDS` | — | Extra task ids to approve (comma-separated) |
| `SCAN_INTERVAL_SECONDS` | 300 | Seconds between passes |
| `MIN_REWARD` | 1 | Minimum reward to consider |
| `REWARD_TOKENS` | G$,USDC,CELO,cUSD | Worker allowlist |
| `MAX_TASKS_PER_RUN` | 1 | Max new claims per pass |
| `DRY_RUN` | 0 | Log actions without sending txs |

## Contract

- **BalaioTasksV2:** `0xe60aa33E8Dee3Bb1B2218bF025AcB624312D519E` (Celo mainnet)
- **G$:** `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A`
- **RPC:** `https://forno.celo.org`

## Notes

- Metadata-only POST does not make a task claimable — `createTask` on-chain is required.
- v2.0 deliverables are structured text + GoodAgent verify link; customize
  `buildDeliverable` in `src/worker.ts` for custom logic.
