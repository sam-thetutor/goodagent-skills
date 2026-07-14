# ubi-reminder

A Telegram agent that reminds subscribers to claim their daily GoodDollar UBI
— and makes claiming a game with fully on-chain streaks and stats.

## What it does

- Users DM the bot a Celo wallet address; the agent watches it 24/7.
- Every scan it batch-reads the chain (one multicall per pass) and pings each
  chat **at most once per UBI day** when there's an unclaimed entitlement.
- **On-chain claim streaks** — the agent reads `UBIScheme.lastClaimed(wallet)`
  each pass and detects claims the moment they land on-chain. Consecutive UBI
  days grow a streak; `/streak` shows yours, `/top` is the bot-wide
  leaderboard.
- **Live pool stats** — `/pool` reads `getDailyStats()`, `dailyUbi()` and
  `currentDay()` straight from the UBIScheme contract: claimers today, G$
  distributed today, today's claim amount.
- **Identity expiry warnings** — the agent reads
  `Identity.identities(wallet).dateAuthenticated` plus
  `authenticationPeriod()` and warns subscribers days before their face
  verification lapses, so they never silently stop earning.
- **Verifiable agent** — the bot itself is a GoodAgent: its key is attested
  on-chain and a human vouch backs it with a refundable G$ bond. `/start`
  shows a live verification link.

The agent only ever **reads** public chain data. It never holds user funds and
never asks for keys.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | — (required) | Bot token from @BotFather; each deployer brings their own bot |
| `BOT_NAME` | deploy display name | Name used in the welcome message |
| `CELO_RPC_URL` | `https://forno.celo.org` | Celo RPC endpoint |
| `REMINDER_INTERVAL_MINUTES` | `15` | Minutes between chain scans |
| `IDENTITY_EXPIRY_WARN_DAYS` | `14` | Warn when face verification expires within N days |
| `DEPLOY_ID` / `GOODAGENT_HOST_URL` / `HOST_INTERNAL_SECRET` | injected by host | Central subscriber store scoping |

## Storage

Subscribers live in the central GoodAgent database via the host's
`/deploy/:id/telegram/*` endpoints, scoped by `DEPLOY_ID` — every deployed
reminder bot has its own subscriber list, its own streaks, and its own
leaderboard.

## Commands

`/start` `/status` `/streak` `/pool` `/top` `/list` `/remove 0x…` `/stop` `/help`
