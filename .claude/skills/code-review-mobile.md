<!-- CORE: agnostic -->
---
name: code-review-mobile
description: Review a plan (mode=plan, pre-implementation) or implemented code (mode=code, pre-merge), with fail-loud toolchain preconditions for environments that may lack the project's toolchain. Variant of code-review for web/mobile sessions; invoked by the start-mobile orchestration. Use when the user says "review the plan" or "review my code" in a web or mobile session.
---

# code-review-mobile

Two strict modes. The mode is required — refuse to run without it.

This is the variant of the desktop `code-review` skill for sessions
whose environment may lack the project's toolchain (Claude Code web /
mobile); the checks are identical, plus the toolchain preconditions
below. The `-mobile` suffix lets both variants coexist in the same
repo; `start-mobile` always invokes this one.

## Toolchain preconditions (mode `code`)

This pack runs in environments where the project's toolchain may be
absent (e.g. a mobile sandbox without the runtime, the package manager,
or network access for dependencies). Before reviewing code, resolve the
project's lint / typecheck / test commands from `CLAUDE.md` and try
them:

- If the commands **run** — even if they report failures — proceed with
  the review. Failures are review findings, not environment problems.
- If a command **cannot run at all** (interpreter or package manager
  missing, dependencies not installable, no network), **stop**. Output
  neither `APPROVE` nor `REQUEST CHANGES`. State exactly which command
  failed and which prerequisite is missing, then give the recovery
  options: provision this environment (install the runtime /
  dependencies), or run this review in a desktop session where the
  toolchain is available.
- "Toolchain absent" is a loud stop, never an implicit approval path.
  Skipping the test gate silently would approve unverified code.

## Mode `plan` — pre-implementation

Read the issue, the plan comment, and the relevant existing code. Decide if
the plan is safe to execute as written.

Checks:

- **Architectural fit** — does the plan respect existing module boundaries
  and naming conventions? Look at neighbors of the files being touched.
- **Anti-overengineering** — flag speculative abstractions, premature
  generalization, helpers introduced for one caller, config knobs with no
  current consumer, parallel implementations of something that already
  exists.
- **Scope discipline** — does the plan match the issue, or does it grow new
  scope? "While we're here, let's also..." is a red flag.
- **Test gaps** — does the plan say how the change is verified? Unit at
  minimum; integration if I/O, network, or DB are involved.
- **Rollback** — for E2/E3, the plan must say how to undo this if it breaks.
- **Reuse** — is there a function, hook, or utility already in the repo that
  does most of this? If yes, name it.

Output: `APPROVE` or `REQUEST CHANGES`, followed by line items. Each item
either references a plan bullet or a file path.

## Mode `code` — pre-merge

Read the diff, the approved plan, and the touched files in their entirety
where size permits.

Checks:

- **Plan alignment** — implementation matches the approved plan. Any
  deviation must be called out and justified in the PR body.
- **Security** (apply at every boundary):
  - input validated where untrusted data enters,
  - secrets not logged, not committed, not in error messages,
  - authz checks present for every protected operation,
  - no SQL/NoSQL/template/command injection sinks,
  - error messages do not leak internals.
- **Performance** (defensible defaults, not premature optimization):
  - no obvious N+1 in loops over collections,
  - no unbounded fetches from external systems,
  - no synchronous I/O on a hot path,
  - cache invalidation is correct if a cache is touched.
- **Correctness**:
  - error handling at boundaries (not internal, where it adds noise),
  - edge cases listed in the plan are tested,
  - no dead code, no TODOs without an issue link.
- **Conventional Commits** — every commit on the branch follows the format.
  Squash-on-merge counts: PR title must also be conventional.
- **Tests** — added or updated tests cover the change. Run them locally;
  paste output in the PR.

Output: `APPROVE` or `REQUEST CHANGES`, with line items keyed to file:line.

## Hard rules

- Never approve a plan that introduces an abstraction with one caller.
- Never approve code without seeing test output.
- Never approve a `code` review if `plan` mode was skipped.
- If the diff and the plan disagree, the plan wins — request changes.
- If the toolchain is unavailable in this environment, fail loud with
  exactly what is missing and stop — do not approve, do not skip the
  test gate silently. See "Toolchain preconditions" above.
