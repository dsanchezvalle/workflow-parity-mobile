<!-- CORE: agnostic -->
---
name: start-mobile
description: Orchestrate the implementation of an approved issue end-to-end — branch, plan-review, implement, code-review, verify, push — via git + the GitHub MCP server, no gh CLI. MCP-first variant of start for sessions without an authenticated gh (Claude Code web/mobile). Use when the user says "start-mobile #N", or "start #N" / "let's implement #N" in a web or mobile session.
---

# start-mobile

The orchestrator. Runs other skills in sequence, never skips a step.

This is the MCP-first variant of the desktop `start` skill: it runs in
sessions without an authenticated `gh` CLI (Claude Code web / mobile).
Version-control operations (branch, commit, rebase, push) use `git`
against the session's checkout; every GitHub API read and write goes
through the connected GitHub MCP server. The `-mobile` suffix lets both
variants coexist in the same repo; in desktop sessions with `gh`
available, prefer the desktop `start`.

## MCP tooling contract

- **Resolve tools by capability, not prefix.** Tool names in this skill
  are the canonical GitHub MCP names (`get_issue`, `get_issue_comments`,
  `update_issue`, `list_pull_requests`, `get_pull_request_status`); the
  session may expose them under a server-specific prefix. Match by name
  suffix.
- **No GitHub MCP server connected → fail loud.** Stop and tell the
  human: connect the GitHub MCP integration, or run this issue through
  the desktop `github-driven` pack where `gh` is available.
- **Field discipline (token efficiency).** Pick the narrowest tool that
  answers the question; cap page sizes on list calls; extract only the
  fields each step needs. Never re-fetch an object already read this
  session. Never quote a full MCP payload into the conversation, a
  commit, or a PR body.

## Preconditions

- The issue must have **either** a `status: ready` label **or** an
  `effort/E0`–`effort/E3` label applied (read them with `get_issue`,
  keep `labels[].name` only). If both are absent the issue has not been
  triaged. Refuse and tell the human:

  > This issue has not been triaged. Run `/analyze-mobile #N` first to
  > classify effort and post a plan; then re-run `/start-mobile #N`.

  Rationale: skipping the analyze step means there is no plan to
  review, which makes `code-review-mobile (plan)` operate on nothing
  and breaks the audit trail.
- The issue has an **approved plan** comment: a comment containing the
  literal word `approved` from a maintainer (read the thread with
  `get_issue_comments`, keep author + body only). That comment is the
  **only** approval signal this skill accepts. If it does not exist,
  stop and ask the human to post one — do not infer approval from
  reactions or anything else.
- The working tree is clean (`git status` empty).
- The default branch is `develop`. Pull latest before branching.
- The remote is reachable from this session (`git fetch origin`
  succeeds). If it fails, stop and report the exact error — do not
  implement work the session cannot push.

If any precondition fails, **stop** and tell the human exactly which one.

## Steps

1. **Move issue to In Progress.** Apply `status: in progress` and
   remove `status: ready` via read-modify-write — most servers'
   `update_issue` replaces the full label set, so: take the label names
   you already read, swap the two, write the set back (prefer dedicated
   add/remove-label tools when the server has them).

   Board sync is server-side: the label event triggers
   `project-status-labeled.yml`, which moves the card to `In Progress`
   reading the project number from `.github/project.env`. Do **not**
   invoke any sidecar script and do **not** mutate the board from the
   session. Label names are exact — see `AGENTS.md` → `Required labels`.
2. **Branch** from `origin/develop`:
   - Type prefix from the issue's `type/*` label (or asked, if absent):
     one of `feat`, `fix`, `docs`, `refactor`, `chore`, `test`.
   - Slug: kebab-case of the issue title, max 6 words.
   - Branch name: `<type>/<issue>-<slug>`.
   - **Fail-fast push check**: run `git push --dry-run -u origin
     <branch>` now. A dry run contacts the remote without updating refs
     or triggering workflows. If it fails (auth, permissions), stop and
     report the exact error before any implementation work happens.
3. **Plan review** — invoke `code-review-mobile` in `plan` mode against
   the approved plan. If `REQUEST CHANGES`, post the review on the issue
   (`add_issue_comment`), stop.
4. **Implement** — write code in logical commits. Each commit:
   - is Conventional (`<type>(<scope>): <subject>`),
   - keeps the tree green (lint + typecheck pass),
   - is small enough to review on its own.
5. **Code review** — invoke `code-review-mobile` in `code` mode. If
   `REQUEST CHANGES`, fix in new commits and re-run. Do not amend reviewed
   commits. If `code-review-mobile` stops because the toolchain is
   unavailable in this environment, resolve that first — do not push
   unreviewed code.
6. **Sync check** — if any of `CLAUDE.md`, `AGENTS.md`, or
   `.github/workflows/` changed, run `verify-sync`. If it fails, stop.
7. **Rebase** onto `origin/develop`. Resolve any conflicts in the PR
   description, not silently.
8. **Push** the branch. The `auto-pr.yml` workflow opens the PR.

## Post-push

- Confirm the PR was opened: poll `list_pull_requests` with this branch
  as head (keep `number` + `state` only) for up to 30s.
- Confirm the issue moved to In Review: `project-status.yml` flips the
  label on PR open — re-read the label names once. The board mirrors
  the transition server-side via `project-status-labeled.yml` (it
  reacts to the PR events directly).
- **Fill the verification slot in the PR body.** `auto-pr.yml` opens
  the PR with a `## Verification` section containing the placeholder
  `<!-- start fills here -->`. Read the PR body via `get_pull_request`,
  substitute the placeholder with the 1–3 line verification summary
  required by the start contract, and `update_pull_request` with the
  new body. If the placeholder is absent (older `auto-pr.yml`), append
  a fresh `## Verification` section with the same summary text.
- Watch CI via the PR's check results (`get_pull_request_status` or the
  server's check-runs tool — keep check names + conclusions only). If a
  check fails, fix it before tagging a reviewer.

## Re-run policy

Before doing any work, **check whether this issue already has start
artifacts in flight**:

- A branch on the remote matching `<type>/<issue>-*` for this issue
  number (any type prefix) — no MCP call needed:
  `git ls-remote --heads origin | grep -E '/(feat|fix|docs|refactor|chore|test)/<issue>-'`.
- An open PR for any branch found above (`list_pull_requests` with that
  head, `number` + `state` only).
- A `status: in progress` or `status: in review` label (already in the
  labels you read at preconditions — do not re-fetch).

If **any** of those exists, refuse loud. A silent re-run would diverge
the in-session work from the canonical surfaces (branch, PR, labels),
which is fail-silent and harder to recover from than a clean re-do.

Stop and reply:

> Issue #N already has a start branch / PR / status label in flight,
> whether it came from this variant or the desktop `start`. Silently
> re-running would diverge what I produce in this session from what
> the issue and remote record.
>
> If you want to redo the implementation, clean the canonical state
> first:
>
>   1. Close the open PR (if any) — `update_pull_request` with state
>      `closed`, or the GitHub UI.
>   2. Delete the existing branch locally and on the remote
>      (`git branch -D <branch>` + `git push origin --delete <branch>`).
>   3. Move the issue back to `status: ready` — remove the in-flight
>      labels and add `status: ready` back with the same
>      read-modify-write label swap (`update_issue`). Per the repo's
>      contract (AGENTS.md → Required labels), every open issue must
>      carry a status label.
>   4. The board move-back is automatic: re-applying `status: ready`
>      triggers `project-status-labeled.yml`, which moves the card to
>      the `Ready` column. No manual board step.
>   5. Re-run `/start-mobile #N`.
>
> If you only want to add more commits to the existing branch, do
> that directly — don't re-invoke `/start-mobile`.

The engineer or tech-lead owns the cleanup decision; the skill never
auto-deletes branches or PRs.

## External output style (commits + PR body)

The rich context lives **internally** — issue comments, analyze plans, and
code-review comments are all on the GitHub issue and PR (accessible to
authorized contributors but separate from the deliverable itself).
Externally-visible artifacts (commit messages, PR title/body, documentation
produced as the issue's deliverable) must be concise and must not reference
the workflow's internal machinery. Their audience is collaborators reviewing
the diff, not the orchestration process that produced it.

### Commit messages

- **Subject**: Conventional Commits (`<type>(<scope>): <subject>`),
  max 72 chars. Imperative mood.
- **Body**: optional. Only if it adds info the subject cannot capture
  (rollback hint, breaking change marker, security implication). Max ~3
  lines. **Never copy the analyze plan into the commit body.**

If a commit's body would be more than 3 lines of summary, that's a signal
to split the work into multiple commits, not to fatten the message.

### PR body

Suggested skeleton:

```
<1-2 sentences: what changed + why>

## Changes
- <bullet 1>
- <bullet 2>
- ... (5–8 bullets, up to ~10 if strictly needed, file/area/concept level)

## Verification
<1-3 lines: build pass, tests, what was visually checked>

Closes #<issue-number>
```

Do **not** dump the issue body, the analyze plan, full file inventories,
or "out of scope" lists into the PR description. The analyze plan lives on
the GitHub issue; collaborators who land on the PR don't need it to
understand the change.

Target: ~25 lines total across all commit bodies + PR body combined for any
single issue (~30 if the change is genuinely complex). If the engineer feels
the work needs more context to be reviewable, the issue should probably be
split into smaller pieces.

### Override: test output in the PR body

The `code-review-mobile.md` skill says "Run them locally; paste output in
the PR" — that guidance assumed the PR body was the only durable
verification trail. In the GitHub-driven flow the `code-review-mobile`
skill runs at **step 5, before the push at step 8**, so no PR exists yet.
Test output is in-session context during the review step. Therefore:

- Run tests locally as required by `code-review-mobile.md`. Non-negotiable.
- In the PR body, summarize the verification in 1-3 lines — e.g.
  `unit + integration green locally; lint + typecheck pass`. Do **not**
  paste raw test output, coverage tables, or terminal dumps into the PR
  body.
- If reviewers need the full output, post it as a **PR comment** after the
  PR opens — not in the body.

### Anti-leak rule (no workflow references in external artifacts)

External-facing artifacts must not reference the workflow's internal
machinery. Collaborators reviewing the diff should see clean, conventional
commit messages and PR bodies — not the orchestration scaffolding that
produced them.

**Forbidden in any external artifact**:
- Skill names invoked during the workflow (`/analyze-mobile`,
  `/start-mobile`, `/code-review-mobile`, `/review-pack`, etc.).
- Status label values used as workflow references (e.g.,
  `status: ready`, `status: in progress`, `effort/E2`) — if a change's
  state is worth mentioning, describe it in plain language.
- Meta-commentary about the orchestration process ("as per the analyze
  plan", "skipping code-review for E0", etc.).

**Does not apply to**:
- `Closes #N` in PR bodies — this is the standard GitHub convention for
  linking a PR to its issue and should be used.
- Any repo whose subject **is** this workflow itself (e.g.
  `workflow-template`, forks, or repos whose docs legitimately describe
  the workflow). In those repos, naming skill names is required in the
  appropriate files. Apply judgment: if a commit edits a skill spec,
  mentioning `/start-mobile` is required; if it lands an unrelated
  feature, the anti-leak rule still applies to that feature's commit and
  PR body.

**Applies to**:
- Commit subjects and bodies.
- Branch names.
- PR titles and descriptions.
- Documentation, guides, READMEs, runbooks produced as part of the
  issue deliverable.
- Any other artifact visible to collaborators in the remote (release
  notes, replies on PR comments, etc.).

## Hard rules

- Never push to `develop` or `main` directly.
- Never use `--force` or `--no-verify`.
- Never skip `code-review-mobile (plan)` — even for E0 changes inside
  `start-mobile`.
- If `start-mobile` is invoked on an issue without an approved plan,
  refuse and point the human at `analyze-mobile`.
- Never re-run silently when start artifacts (branch / PR / in-flight
  status) already exist for the issue. See "Re-run policy" above.
- Never copy the issue body, analyze plan, or code-review comments
  verbatim into commit messages or PR body. External outputs are concise
  per the "External output style" section above.
- Never reference workflow internals (skill names, status labels, workflow
  process meta-commentary) in any external artifact — commits, branch
  names, PR title/body, or documentation produced as part of the
  deliverable. See the "Anti-leak rule" section under External output
  style.
- No `gh` CLI, no sidecar scripts. `git` owns version control; every
  GitHub API read and write goes through the MCP server per the tooling
  contract. If the server is missing or a push fails, fail loud — never
  degrade silently.
