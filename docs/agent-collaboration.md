# Agent Collaboration Protocol (read this first, every task)

> **Audience:** every coding agent (and human) working in this repository.
> **Why this exists:** the three developers and their agents work on **different devices and accounts**. Agents cannot message each other directly. **GitHub pull requests are the only communication channel.** Anything not written on a PR (or in the repo) does not exist for the other agents.

Related docs: [`implementation.md`](implementation.md) (ownership, contracts, schedule) and [`project.md`](project.md) (product spec).

---

## 1. Roles

| Role | Branch | Owns | May merge to `main`? |
|---|---|---|---|
| Developer A agent | `feat/a-agents-api` | `services/api/**` | No |
| Developer B agent | `feat/b-engineering` | `packages/engineering/**` | No |
| Developer C agent | `feat/c-3d-sim` | `apps/web/**` | No |
| Designer | `design/visual-system` | `design/**` | No |
| **Integrator agent** | runs from `main` | nothing; merge timing and review only | **Yes (only role)** |

- File ownership is defined in `implementation.md` §2. Do not edit another lane's folder.
- **An integrator agent runs on a roughly 30-minute schedule.** Each run it lists open PRs, checks them, then either merges a PR or leaves a review asking for changes. Expect feedback on your PR within about 30 minutes of pushing.
- Lane agents **never merge their own PRs** and never push directly to `main`.

---

## 2. One-time setup per device (required)

Every teammate must do this on their own machine before their agent starts work. An agent that cannot pass step 4 must **stop and tell its human**. It must not work around it.

```bash
# 1. Install the GitHub CLI
brew install gh            # macOS; Linux: https://github.com/cli/cli#installation

# 2. Authenticate (GitHub.com, HTTPS, browser login)
gh auth login

# 3. Point gh at this repo (run inside the clone)
gh repo set-default        # pick this repository when prompted
git remote -v              # confirm origin is the shared repo

# 4. Verify (must succeed before any work)
gh auth status
gh pr list
```

Rules:
- Never paste tokens into files, commits, PR text, or chat. `gh auth login` stores credentials in the system keyring.
- If the human wants the agent to run these in Claude Code, they can type `! gh auth login` in the prompt (interactive login must be done by the human).
- Each person authenticates as themselves, so PRs and reviews show who did what.

---

## 3. Lane agent workflow

### Starting work
1. `git fetch origin && git switch <your-branch>` (create it from `main` if it doesn't exist).
2. Rebase onto the latest `main` if `main` has moved: `git rebase origin/main`.
3. **Check for feedback before doing anything else** (see "Checking feedback" below).

### While working
- Keep commits small and **only inside your owned folders**.
- Run your lane's tests before every push (commands in `implementation.md` §12).
- Push often so the integrator sees progress: `git push -u origin <your-branch>`.

### Opening a PR
```bash
gh pr create --base main --title "<lane>: <short summary>" --body-file - <<'EOF'
**Lane:** A | B | C | Designer
**What changed:** ...
**Tests run:** <exact commands and result>
**Touches contracts/ or fixtures/?** yes | no  (if yes, see section 5)
**Known gaps / follow-ups:** ...
EOF
```
One open PR per branch. Update it by pushing more commits; don't open duplicates.

### Checking feedback (at the start of every task AND on every loop tick)
```bash
git fetch origin
gh pr view --comments          # reviews and comments on your PR
gh pr checks                   # CI status
gh pr view --json reviewDecision,mergeable,statusCheckRollup
```
- Address **every** unresolved "changes requested" comment. Make the change, run tests, push.
- Reply on the PR so the integrator knows it is done: `gh pr comment --body "Fixed in <sha>: <what changed>"`.
- If a comment is unclear or you disagree, say so on the PR with specifics rather than ignoring it.

Optional, in your own Claude Code session:
```text
/loop 10m check my PR for review feedback and CI results, address anything outstanding, push, and reply
```

---

## 4. Integrator agent workflow (every ~30 minutes)

For each open PR (`gh pr list --state open --json number,title,headRefName,labels`):

1. **Scope check:** `gh pr diff <n> --name-only`. Every changed file must be inside the PR owner's folders (section 1). Out-of-scope files → request changes.
2. **Contract check:** if the diff touches `contracts/**` or `fixtures/**`, do **not** merge. Add the label `needs-human` and comment asking for sign-off from all three developers (section 5).
3. **CI check:** `gh pr checks <n>`. If checks are failing or pending, don't merge.
4. **Local verification:** `gh pr checkout <n>`, then run that lane's tests (`implementation.md` §12). Return to `main` afterward.
5. **Decide:**
   - Failing or out of scope → request changes with actionable feedback:
     ```bash
     gh pr review <n> --request-changes --body "<feedback>"
     ```
   - Passing, green CI, in scope, not a contract change → merge:
     ```bash
     gh pr merge <n> --squash
     ```
6. If a merge leaves other open PRs behind, comment on them: `Please rebase on main`.

### Feedback format (be specific so another agent can act without guessing)
```text
1. <file>:<line or symbol> - <what is wrong / which test fails> - <exact change expected>
2. ...
Re-request review by commenting "ready" after pushing.
```
Vague feedback ("clean this up") is not acceptable. Name the file, the failing test or rule, and the expected result.

---

## 5. Rules for everyone

- **Contracts and fixtures are frozen** (`contracts/**`, `fixtures/**`). Changes need agreement from all three developers (`implementation.md` §5). Open a PR with the 5-line change proposal; the integrator labels it `needs-human` and never auto-merges it.
- **No force-push** to `main` or to anyone else's branch. Force-push your own branch only after rebasing, and say so in a PR comment.
- **Merge conflicts** are resolved by the PR's owner, on their branch.
- **No secrets** in commits, PRs, logs, or fixtures. Use `.env.example` for names only.
- **No silent fakes.** Fixture or fallback output must stay labeled, as required throughout `implementation.md`.
- **If blocked,** write what you need on the PR or in a PR comment. Don't wait silently and don't edit another lane's folder.
- Recommended repo settings (humans, one time): branch protection on `main` requiring the lane CI checks, no direct pushes, no force-push.

---

## 6. Quick reference

| Goal | Command |
|---|---|
| Am I logged in? | `gh auth status` |
| List open PRs | `gh pr list` |
| Create a PR | `gh pr create --base main` |
| Read feedback | `gh pr view --comments` |
| See CI results | `gh pr checks` |
| Reply on a PR | `gh pr comment --body "..."` |
| Request changes (integrator) | `gh pr review <n> --request-changes --body "..."` |
| Merge (integrator) | `gh pr merge <n> --squash` |
| Files a PR touches | `gh pr diff <n> --name-only` |
| Test a PR locally | `gh pr checkout <n>` |
