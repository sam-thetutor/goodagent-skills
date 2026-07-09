# GoodAgent Skill Specification (v1)

A **skill** packages everything an AI agent needs to use one on-chain product: instructions it can read, code it can run, and a manifest that declares what the skill is allowed to do.

The format follows the open [Agent Skills](https://agentpatterns.ai/standards/agent-skills-standard/) standard (`SKILL.md` + folder), extended with a permissions manifest for on-chain safety.

## Layout

```
skills/<skill-name>/
  SKILL.md          # manifest (YAML frontmatter) + agent-readable instructions
  package.json      # runnable reference implementation
  tsconfig.json
  .env.example      # every env var the skill needs, with comments
  src/              # TypeScript source of the reference implementation
```

## SKILL.md frontmatter

```yaml
---
name: gamearena-player
skill_id: gaming/wagering/gamearena_1v1        # OASF-style capability id
description: One line — what the skill does and when to use it.
version: 1.0.0
chain: celo:42220
permissions:
  spends_tokens: true          # does this skill move funds?
  token: G$                    # which token
  max_spend_per_action: "5"    # hard cap the reference impl enforces
  daily_loss_cap: "20"         # cumulative cap before it stops itself
required_env:
  - PRIVATE_KEY                # agent wallet key (never commit)
contracts:
  - name: ArenaPlatform
    address: "0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE"
verification: recommended      # none | recommended | required
---
```

## Instruction body

The markdown below the frontmatter must be self-sufficient for an LLM agent:
state the game rules, the exact contract calls with encodings, the happy path
step by step, failure modes, and the safety limits. Assume the reader is an
agent with a wallet and a code interpreter, not a human with a browser.

## Reference implementation

Every skill ships a runnable worker (`npm start`) that implements the
instructions with the declared caps enforced in code. It must be
self-contained (no dependency on this repo's other folders).

## Permissions & safety

- Spending caps in the frontmatter are contracts with the user: the reference
  implementation must enforce them.
- Skills must never require exporting keys anywhere other than the local env.
- Read-only skills set `spends_tokens: false`.

## Registry

Add your skill to `registry.json` so marketplaces and agents can discover it:

```json
{
  "name": "gamearena-player",
  "skill_id": "gaming/wagering/gamearena_1v1",
  "path": "skills/gamearena-player",
  "description": "...",
  "chain": "celo:42220",
  "spends_tokens": true
}
```
