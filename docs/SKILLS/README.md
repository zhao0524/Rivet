# Agent skills

Index of the agent skills installed in this repo. 80 skills from 9 upstream repositories,
imported with the [`skills`](https://skills.sh) CLI.

Skills are **not** stored in this folder. They live where agents actually read them:

- `.devin/skills/<name>/SKILL.md` — read by Devin
- `.claude/skills/<name>/SKILL.md` — read by Claude Code

Both are full copies (installed with `--copy`, so nothing symlinks into `node_modules`).
`skills-lock.json` at the repo root pins each skill to its source repo and content hash.

A skill is a folder with a `SKILL.md`: front-matter `name` and `description`, then
instructions, plus optional scripts and reference files. Agents load the description list
up front and read the body only when a task matches, so adding skills costs little context.

## Web scraping and browser automation

| Skill | Source | Notes |
| --- | --- | --- |
| `agent-browser` | `vercel-labs/agent-browser` | Driving a real browser: navigate, fill forms, click, screenshot, extract. No API key. |
| `playwright-cli` | `microsoft/playwright-cli` | Official Playwright CLI workflows and test authoring. |
| `crawl4ai` | `brettdavies/crawl4ai-skill` | JS-heavy pages and SPAs, concurrent crawls, CSS/JSON extraction schemas (LLM-free). Python `crwl`. |
| `webapp-testing` | `anthropics/skills` | Poke at a locally running app via Playwright; capture screenshots and console logs. |
| `dev` | `microsoft/playwright-cli` | Maintenance workflows for the playwright-cli repo itself. Rarely relevant here. |

All of these run against a local browser or plain HTTP. No scraping vendor accounts were
installed — Browserbase, Oxylabs, Apify and Firecrawl skills were deliberately skipped
because they need paid API keys. Add them later if that changes.

Relevant to this repo: the e-commerce layer fetches and verifies vendor offer pages
(`packages/engineering/rivet_engine/ecommerce/`), and the showcase ingest records pages
into `fixtures/showcase/recorded/`. `crawl4ai` and `agent-browser` are the tools of choice
when authoring new recorded fixtures.

## Engineering process

From `obra/superpowers` — the discipline skills, strongest fit for lane-based work:

`brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`,
`dispatching-parallel-agents`, `test-driven-development`, `systematic-debugging`,
`requesting-code-review`, `receiving-code-review`, `verification-before-completion`,
`using-git-worktrees`, `finishing-a-development-branch`, `writing-skills`,
`using-superpowers`, `diagnosing-superpowers`.

From `mattpocock/skills` — spec-to-ticket-to-code flow and review tooling:

`research`, `to-spec`, `to-tickets`, `implement`, `implement-spec`, `tdd`, `code-review`,
`pr`, `diagnosing-bugs`, `codebase-design`, `domain-modeling`,
`improve-codebase-architecture`, `prototype`, `triage`, `wayfinder`, `retro`, `handoff`,
`claude-handoff`, `chief-of-staff`, `grilling`, `grill-me`, `grill-with-docs`, `teach`,
`wizard`, `wait-what`, `loop-me`, `to-questionnaire`, `ask-matt` (router over the set),
`writing-for-agents`, `writing-beats`, `writing-fragments`, `writing-shape`,
`setup-matt-pocock-skills`, `setup-pre-commit`, `setup-ts-deep-modules`,
`migrate-to-shoehorn`, `scaffold-exercises`, `git-guardrails-claude-code`.

Note: `setup-matt-pocock-skills`, `setup-ts-deep-modules` and `setup-pre-commit` *change*
repo configuration. Read them before running them.

## Language and framework

| Skill | Source | Fits |
| --- | --- | --- |
| `fastapi` | `fastapi/fastapi` (official) | `services/api` — routes, Pydantic models, dependencies, SSE streaming. |
| `python-best-practices` | `nathan-gage/python-skills` | `packages/engineering`, `services/api`. |
| `python-async-best-practices` | `nathan-gage/python-skills` | Async job orchestration and the SSE pipeline. |
| `python-pytest` | `nathan-gage/python-skills` | The pytest suites under `services/api/tests` and `packages/engineering/tests`. |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | `apps/web` (Next.js 14). |
| `vercel-composition-patterns` | `vercel-labs/agent-skills` | Component API design in `apps/web`. |
| `vercel-react-view-transitions` | `vercel-labs/agent-skills` | Step/route transitions in the flow UI. |
| `web-design-guidelines` | `vercel-labs/agent-skills` | UI and accessibility review. |
| `frontend-design` | `anthropics/skills` | Visual direction for new UI. |
| `vercel-optimize`, `deploy-to-vercel`, `vercel-cli-with-tokens` | `vercel-labs/agent-skills` | Deployment. Need a Vercel token. |
| `vercel-react-native-skills` | `vercel-labs/agent-skills` | Not used by this repo. |

## Documents, artifacts and tooling

`docx`, `pdf`, `pptx`, `xlsx` (file generation and extraction), `doc-coauthoring`,
`writing-guidelines`, `web-artifacts-builder`, `mcp-builder` (build MCP servers),
`skill-creator` (author and eval new skills). All from `anthropics/skills` except
`writing-guidelines` (`vercel-labs/agent-skills`).

## Managing the set

```bash
npx skills ls                     # list project skills
npx skills find <query>           # search the registry
npx skills add <owner>/<repo> --skill '*' -a devin claude-code --copy -y
npx skills add <owner>/<repo> -l  # preview a repo's skills without installing
npx skills update -p              # update project skills
npx skills remove <name>          # remove
npx skills init <name>            # scaffold a repo-local skill
```

Install to `-a devin claude-code` so both agents see the skill. Use `--copy`; the default
symlinks into `node_modules`, which breaks for anyone who hasn't run `pnpm install`.
Repo-local skills we write ourselves belong in `.devin/skills/` and should not be added to
`skills-lock.json`.

## Caveats

- Skills execute with full agent permissions. Read a `SKILL.md` before trusting it.
  These came from upstream repos; only `anthropics/skills`, `fastapi/fastapi`,
  `microsoft/playwright-cli` and the `vercel-labs` repos are first-party publishers.
- The registry is full of mirror repos that re-publish `obra/superpowers` alongside
  unrelated content. Installs here come from the canonical owners.
- Both copies total about 18 MB. If that is too much in git, track `.devin/skills/` and
  ignore `.claude/skills/`, or ignore both and restore with
  `npx skills experimental_install` from `skills-lock.json`.
