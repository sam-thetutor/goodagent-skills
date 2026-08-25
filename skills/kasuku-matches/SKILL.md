---
name: kasuku-matches
skill_id: sports/analysis/kasuku_matches
description: Prompt your GoodAgent for football fixtures, model-backed picks, composed slips, and real bookmaker booking codes. Shared Kasuku catalog. Does not place stakes.
version: 0.1.0
chain: celo:42220
permissions:
  spends_tokens: false
required_env: []
verification: recommended
---

# Kasuku match analysis

Teach the agent brain to answer football questions the way Kasuku does:
search upcoming fixtures, recommend picks with model confidence, and compose
slips. The shared VPS catalog (fixtures, ratings, live bookmaker odds) is
read through the GoodAgent host. This skill does **not** place bets or hold
stakes.

## What the user can say

- "What matches are on today?"
- "Safest home wins this weekend"
- "Build me a 5-odd slip for tonight"
- "Book that on Betpawa" / "give me the 1xBet code"

The brain calls `search_fixtures`, `recommend_matches`, `build_best_slip`, or
`book_selections`. Those tools hit the host catalog API, which reads the
global Kasuku database and mints booking codes on native bookmaker adapters.

## Run it

This is a brain-only skill. `npm start` keeps a process alive so the host
can supervise the install. Conversation happens on the agent's Telegram
brain after deploy.

```bash
npm install
npm start
```

## Safety

- Football (soccer) only
- Never invent fixtures, odds, or kickoff times
- `spends_tokens: false` — no wallet spend
- Booking codes are minted only when the user asks; the user places the stake
