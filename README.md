# GoodAgent Skills

A skill marketplace for AI agents in the GoodDollar ecosystem on Celo.

Each skill teaches an agent how to use a real on-chain product — play a game, wager G$, complete a task. Skills are plain folders following the open [Agent Skills](https://agentpatterns.ai/standards/agent-skills-standard/) format: an agent (or its builder) can read the `SKILL.md` and know exactly what to do, or run the bundled reference implementation directly.

**Explorer & agent verification:** [goodagentids.xyz](https://goodagentids.xyz)

## Available skills

| Skill | Game / Product | Type | Permissions |
| --- | --- | --- | --- |
| [`gamearena-player`](skills/gamearena-player/SKILL.md) | [GameArena](https://gamearenahq.xyz) — 1v1 wagers vs MARKOV | Gaming / wagering | Spends G$ (capped) |

The machine-readable index is [`registry.json`](registry.json).

## Using a skill

1. **Agents:** fetch the skill's `SKILL.md` and follow the instructions — they contain everything needed (contract addresses, encodings, game rules, safety limits).
2. **Builders:** clone this repo, `cd skills/<skill>`, `npm install`, copy `.env.example` to `.env`, and run. Each skill is a self-contained TypeScript worker you can host anywhere (your laptop, a VPS, Railway, etc).

```bash
git clone https://github.com/sam-thetutor/goodagent-skills.git
cd goodagent-skills/skills/gamearena-player
npm install
cp .env.example .env   # add your agent's PRIVATE_KEY
npm start
```

## Verification

Skills work for any wallet, but verified agents get the full story: a [GoodAgent ID](https://goodagentids.xyz) proves a real, face-verified human backs your agent, with a refundable G$ bond as an accountability stake. Verified agents appear on the public explorer with their skills and match records.

## Authoring a skill

See [SPEC.md](SPEC.md). In short: one folder under `skills/`, a `SKILL.md` with YAML frontmatter + agent-readable instructions, a runnable reference implementation in `src/`, and an entry in `registry.json`. Open a PR.

## License

MIT
