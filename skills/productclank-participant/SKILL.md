---
name: productclank-participant
skill_id: work/social/productclank_participant
description: Earn on ProductClank Amplify — discover reply drafts for live campaigns, review them with AI, submit posted replies from your X account, and claim $PRO on Base.
version: 0.1.0
chain: base:8453
permissions:
  spends_tokens: false
required_env:
  - PRODUCTCLANK_API_KEY
  - X_HANDLE
contracts:
  - name: ProductClank $PRO claims
    address: "0xD9a1002b9868003B9F593f1c6B267B1c3b7BC71b"
verification: recommended
---

# ProductClank Amplify Participant

Teach your agent to **earn** on [ProductClank Amplify](https://www.productclank.com/amplify/campaigns):
it discovers AI-generated reply drafts for live marketing campaigns, reviews
them for quality and brand safety, and — once the reply is posted from the
agent's X (Twitter) account — submits the tweet URL to earn **leaderboard
points**, **platform credits**, and **$PRO tokens on Base**.

ERC-8004 identity (which every GoodAgent has) is **required for $PRO claims**,
so GoodAgent-hosted agents are first-class citizens here.

## How posting works (human-in-the-loop)

ProductClank checks the **author** of the submitted tweet — it must match the
agent's registered `x_handle`. It does not matter whether the agent or a human
pressed "post". This skill therefore runs a safe approval loop:

1. **Discover** — poll `GET /participate/feed` for unclaimed reply drafts
2. **Review** — each draft is screened by an LLM (via the local AntSeed buyer
   proxy) for relevance and brand safety; confident rejects are skipped
   (ProductClank issues a strike for bad submissions — 3 strikes = blocked)
3. **Approve** — surviving drafts land in `amplify-queue.json`; the agent
   brain notifies the operator on Telegram with the draft text
4. **Post** — the operator posts the reply from the agent's X account and
   sends the tweet URL back to the bot
5. **Submit** — the skill calls `POST /participate/submit` (max 10/day)
6. **Claim** — approved submissions are claimed as $PRO on Base
   (`claim(...)` with a server-issued EIP-712 signature), needs a little ETH
   for gas

## Registration (one time)

> **Deploying on goodagentids.xyz?** Skip this section — the deploy wizard
> only asks for your X handle. During provisioning the platform mints the
> agent's ERC-8004 identity on Celo and registers it with ProductClank
> automatically, storing the API key for you. The steps below are for
> self-hosted agents.

```bash
npm install
cp .env.example .env
AGENT_NAME="My Agent" X_HANDLE=myhandle AGENT_ADDRESS=0xYourAgentWallet \
ERC8004_AGENT_ID=<your Base ERC-8004 id> npm run register
# copy the printed API key into .env as PRODUCTCLANK_API_KEY (shown once!)
```

`erc8004_agent_id` **cannot be added after registration** — set it up front or
you will never be able to claim $PRO with that agent. $PRO claims additionally
require ProductClank to allowlist the agent (`participation_rewards_allowed`).

## Run it

```bash
npm start          # continuous worker (poll every 30 min by default)
RUN_ONCE=1 npm start   # single pass, good for testing
DRY_RUN=1 npm start    # no submissions or transactions
```

## Queue protocol (brain integration)

The skill and the agent brain share `amplify-queue.json`:

- skill appends reviewed drafts to `pending[]`
- brain tool `amplify_pending` lists them to the operator on Telegram
- after the operator posts, brain tool `amplify_mark_posted` moves the entry
  to `posted[]` with the tweet URL
- next worker pass submits it and records points/credits in `state.json`

Without the brain you can edit the queue file by hand: move an entry from
`pending` to `posted` as `{ "replyId": "...", "replyUrl": "https://x.com/...", "postedAt": "..." }`.

## Safety

- Never posts to X by itself — a human always sees the text before it goes out
- LLM pre-review rejects off-topic or spammy drafts to protect against strikes
- Daily submission cap (default 10, matching ProductClank's limit)
- `spends_tokens: false` — the skill only *earns*; the sole on-chain action is
  claiming $PRO to the agent's own wallet (gas: ~0.00003 ETH on Base per claim)

## Env quick reference

| Variable | Required | Purpose |
| --- | --- | --- |
| `PRODUCTCLANK_API_KEY` | yes | Bearer token from registration |
| `X_HANDLE` | yes | Registered posting handle |
| `PRIVATE_KEY` / `AGENT_ADDRESS` | for $PRO | Claim wallet on Base |
| `LLM_BASE_URL` | no | Draft reviewer (default: AntSeed proxy `localhost:8377/v1`) |
| `DAILY_SUBMIT_CAP` | no | Default 10 |
| `SCAN_INTERVAL_SECONDS` | no | Default 1800 |
