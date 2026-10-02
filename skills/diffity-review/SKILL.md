---
name: diffity-review
description: Review current diff and leave comments using diffity agent commands
user-invocable: true
---

# Diffity Review Skill

You are reviewing a diff and leaving inline comments using the `diffity agent` CLI.

## Arguments

- `ref` (optional): Git ref to review (e.g. `main..feature`, `HEAD~3`) or a GitHub PR URL. Defaults to working tree changes. When both `ref` and `focus` are provided, use both (e.g. `/diffity-review main..feature security`).
- `focus` (optional): Focus the review on a specific area. One of: `security`, `performance`, `naming`, `errors`, `types`, `logic`. If omitted, review everything.
- `paths` (optional): Files or directories to limit the review to (e.g. `/diffity-review performance in src/lib`).
- Anything else is the user's instructions for this review (e.g. `/diffity-review main check the migration for data loss`).

## CLI Reference

```
diffity agent diff --ref <ref>
diffity agent list --ref <ref> [--status open|resolved|dismissed] [--json]
diffity agent comment --ref <ref> --file <path> --line <n> [--end-line <n>] [--side new|old] [--severity must-fix|suggestion|nit|question] --body "<text>"
diffity agent general-comment --ref <ref> --body "<text>"
diffity agent resolve <id> --ref <ref> [--summary "<text>"]
diffity agent dismiss <id> --ref <ref> [--reason "<text>"]
diffity agent reply <id> --ref <ref> --body "<text>"
```

- `--ref` selects the review session. Pass the ref under review to every `agent` command. Without it the CLI uses `DIFFITY_SESSION_ID`, else the diff view opened last, which can be a different ref.
- `--file`, `--line`, `--body` are required for `comment`
- `--line 0` comments on the whole file and takes no `--end-line`
- `--end-line` defaults to `--line` (single-line comment)
- `--side` defaults to `new`
- `--severity` prefixes the body with `[<severity>]`
- `comment` only accepts lines within one hunk of the diff on the given side. Otherwise it fails and prints the line ranges it accepts.
- `general-comment` creates a diff-level comment not tied to any file or line
- `<id>` accepts the full id or a unique prefix of at least 8 characters, from the same session

## Prerequisites

1. Check that `diffity` is available: run `which diffity`. If not found, install it with `npm install -g diffity`.

## Instructions

### Step 1: Pick the ref and ensure diffity is running (without opening browser)

1. Settle on one ref string and pass it as `--ref <ref>` to every `agent` command and to `diffity open`. The browser files comments under the same string, so do not switch between equivalent spellings.
   - No ref requested: `work`
   - Natural language: the matching git ref (e.g. "last 3 commits" is `HEAD~3`)
   - GitHub PR URL: `origin/<base branch>`, with the base branch from `gh pr view <pr-url> --json baseRefName --jq .baseRefName`
2. Run `diffity list --json` to get all running instances. Parse the JSON output and find the entry whose `repoRoot` matches the current repo. One instance serves every ref of its repo, so its `ref` field does not need to match.
3. If **no instance is running** for this repo, start one in the background (for a PR URL see the next point instead):
   - Command: `diffity --no-open <ref>` (or `diffity --no-open` if no ref).
   - Use Bash tool with `run_in_background: true`
   - Wait 2 seconds, then verify with `diffity list --json` and note the port.
4. For a **GitHub PR URL**, run `diffity --no-open <pr-url>` in the background whether or not an instance is running. It checks out the PR branch, fetches the base branch, and starts or reuses the instance. Wait 2 seconds, then verify with `diffity list --json`.

### Step 2: Review the diff

1. **Get the unified diff** directly from diffity. This handles merge-base resolution, untracked files, and all ref types automatically:
   ```
   diffity agent diff --ref <ref>
   ```
   This outputs the full unified diff for the session. Line numbers are in the `@@` hunk headers.
   If `paths` were given, review only the files under them. Read other files for context, but do not comment on them.
2. Run `diffity agent list --ref <ref> --json` so you do not duplicate existing comments.
3. Find and read all relevant project instruction files: the root CLAUDE.md and AGENTS.md, and any CLAUDE.md or AGENTS.md files in directories containing modified files. These define project-specific rules that the diff must follow.

#### Assess the change size and adapt your strategy

4. **Gauge the diff size** and plan your approach. Every file gets a thorough review regardless of diff size. The difference is how you organize the work:
   - **Small** (under ~100 changed lines, 1-3 files): Straightforward — review each file in order.
   - **Medium** (100-500 changed lines, 3-10 files): Group files by area (e.g. backend, frontend, tests, config). Review core logic files first so you understand intent before reviewing the ripple effects.
   - **Large** (500+ changed lines or 10+ files): Group files by area. Start with core logic, then review every remaining file. For mechanically repetitive changes (e.g. the same rename applied to 20 files), verify the pattern is correct on the first few instances, then check every remaining instance for deviations from the pattern — don't skip any, but you can check them faster once the pattern is established.

   No matter the size, **read and review every changed file**. Do not skip or spot-check files.

#### Understand the change before reviewing it

5. **Summarize the change first.** Before looking for problems, build a mental model of the diff:
   - What is this change trying to accomplish? (new feature, bug fix, refactor, config change)
   - Which files are structural changes vs. the core logic change?
   - What is the author's intent? Read commit messages (`git log --oneline <args>`) and any linked issues or PR descriptions for context.
   - What are the key decisions the author made, and what constraints were they working within?

   Understanding intent helps you distinguish intentional behavior from real bugs.

6. For each changed file (adjusted by size strategy above), read the **entire file** (not just the diff hunks) to understand the full context.
7. **Cross-reference callers and dependents.** For any changed function signature, renamed export, modified return type, or altered behavior: grep for usages across the codebase. A function that looks correct in isolation can break every caller. Check:
   - Who calls this function? Will they handle the new return value / error / null case?
   - Who imports this module? Will the changed export name resolve?
   - Does this type change propagate correctly to consumers?
8. Analyze the code changes using the techniques below. If the user gave instructions, they take priority over the generic passes and the rules below: spend most of the review on them, and follow them where they conflict (e.g. a request to flag style issues). If a `focus` argument was provided, concentrate on that area. Otherwise, apply all analysis passes and the signal threshold.

#### How to analyze

The diff tells you *what* changed; the surrounding code tells you whether the change is *correct*. Apply these analysis passes:

**Data flow analysis** — Trace values through the changed code. Where does each variable come from? Where does it go? Check:
- Can a value be null/undefined where the changed code assumes it isn't?
- Does the changed code handle all branches of an upstream conditional?
- If a function's return type changed, do all callers handle the new shape?
- Are there narrowing checks (e.g. `if (x)`) that the diff accidentally moved outside of?

**State and lifecycle analysis** — For stateful code (React state, database transactions, streams, event listeners):
- Does the change create a state that can't be reached or can't be exited?
- Are resources (listeners, subscriptions, file handles) still cleaned up on all paths?
- Can concurrent access corrupt shared state?
- Does the ordering of operations still satisfy invariants (e.g. init before use)?

**Contract analysis** — Check the changed code against the contracts it must satisfy:
- Does the function still satisfy what its callers expect? (Read the callers, don't guess.)
- If it implements an interface or overrides a base method, does it still conform?
- Are pre-conditions and post-conditions preserved?
- For API endpoints: does the response shape match what clients send/expect?

**Boundary analysis** — For code at system boundaries (user input, network, file I/O, IPC):
- Is user-controlled input validated before use?
- Can malformed external data crash the process or corrupt state?
- Are there injection vectors (SQL, shell, XSS, path traversal)?

**Edge case analysis** — Only for cases that *will* happen in practice, not theoretical ones:
- Empty arrays/strings, zero, negative numbers — does the code handle them?
- Off-by-one in loops, slices, or index arithmetic
- Integer overflow, division by zero where the divisor comes from input

#### Completeness check

After analyzing the code for correctness, check whether the change is **complete** — not just correct, but finished:

**Test coverage:**
- If the diff adds new behavior (a new function, endpoint, UI flow, branch), are there tests covering it? If not, flag it as a `suggestion`.
- If the diff fixes a bug, is there a test that would have caught the bug? Regression tests prevent re-introduction.
- If the diff modifies existing behavior, are existing tests updated to match? Stale tests that still pass are worse than no tests — they give false confidence.
- If the diff includes tests, review them for quality:
  - Do they test the **right thing**? (behavior, not implementation details)
  - Do they cover **edge cases** the code handles? (empty input, error paths, boundary values)
  - Are they **isolated**? (no hidden dependencies on test ordering or global state)
  - Could they pass even if the code were broken? (tautological assertions, mocked-away logic)

**Missing pieces:**
- Schema change without a migration?
- New environment variable without documentation or defaults?
- New dependency without lockfile update?
- Changed API response without client-side update?
- New error type without handling at the call site?
- Removed feature without cleanup of related code (dead imports, unused config, orphaned tests)?

Only flag missing pieces that are **clearly needed** for this change to work correctly. Don't flag aspirational improvements.

#### What to flag

Flag real problems that would affect correctness, security, or reliability:
- Code that will fail to compile, parse, or run (syntax errors, type errors, missing imports, unresolved references)
- Logic errors that will produce wrong results (clear bugs, off-by-one errors, broken conditions)
- Security vulnerabilities in changed code (injection, XSS, auth bypass, data exposure)
- Race conditions or data loss risks you can demonstrate with a concrete scenario
- CLAUDE.md or AGENTS.md violations where you can quote the exact rule being broken
- Broken contracts — a changed function that no longer satisfies what its callers expect
- Missing tests for new or changed behavior (as `suggestion`, not `must-fix`, unless the project's CLAUDE.md or AGENTS.md requires tests)
- Incomplete changes — migrations, config, client-side updates that are clearly needed for this change to work

Skip style concerns, linter-catchable issues, and pre-existing problems in unchanged code. Focus on the diff, not the whole file.

#### Validate before commenting

For each finding, verify it's real before posting:
- Re-read the surrounding code — many apparent bugs disappear in full context
- For "missing import" or "undefined variable" claims, grep to confirm
- For broken callers, read the actual call sites
- For CLAUDE.md or AGENTS.md violations, confirm the rule is scoped to this file
- For missing tests, check that there isn't already a test in a different file that covers this path

If a repeated pattern appears across files, comment on the first occurrence and mention the pattern in the general summary instead of duplicating comments.

### Step 3: Leave comments

1. **Order comments by severity.** Post all `must-fix` comments first, then `suggestion`, then `nit`, then `question`. Within each severity, follow file order. This ensures the most important issues are seen first if the author skims.

2. Categorize each finding with a severity. Pass it as `--severity`, which writes the `[must-fix]` style tag into the body, so do not write the tag yourself:
   - `must-fix`: Bugs, security issues, data loss risks. Code that will break or produce wrong results.
   - `suggestion`: Concrete improvements with a clear reason. Real improvements, not style preferences. This includes missing tests, incomplete changes, and better approaches.
   - `nit`: Minor but still worth changing, e.g. a misleading name or a stale comment in the changed code.
   - `question`: Something unclear that needs clarification from the author.

3. For each finding, leave an inline comment using:
   ```
   diffity agent comment --ref <ref> --file <path> --line <n> [--end-line <n>] [--side new] --severity <severity> --body "<comment>"
   ```
   - Use `--side new` (default) for comments on added/modified code
   - Use `--side old` for comments on removed code
   - Use `--end-line` when the issue spans multiple lines
   - Use `--line 0` for a finding about the file as a whole (e.g. a file that should not be committed or should be split)
   - If `comment` fails because the lines are outside the diff, it prints the ranges it accepts on that side. Retry on a listed range that still shows the problem, or fall back to `--line 0`. If the file is not in the diff at all, mention the finding in the general comment instead.
   - **Lead with the problem**, not background. Be specific and actionable.
   - For small, self-contained fixes, include a code suggestion showing the fix
   - For larger fixes (structural changes, multi-location), describe the issue and suggested approach without a full code block
   - If flagging a CLAUDE.md or AGENTS.md violation, quote the exact rule being broken
4. After leaving all inline comments, decide whether a general comment is needed:
   - **No findings → leave a general comment:** "No issues found. Checked for bugs and project rule compliance."
   - **1-2 findings → skip the general comment** unless there's a cross-cutting concern the inline comments don't cover.
   - **3+ findings → leave a general comment** summarizing the themes.
   - **Large diffs → always leave a general comment** noting the scope of the review and grouping findings by area.
   - **Do not use severity prefixes in the general comment** — prefixes are only for inline findings.
   - Lead with the verdict, be direct and concise — no compliments, no filler, no narrating what the code does.
   ```
   diffity agent general-comment --ref <ref> --body "<overall review summary>"
   ```

### Step 4: Open the browser

1. Open the browser now that comments are ready:
   ```
   diffity open <ref>
   ```
   Pass the same ref as in Step 1 (e.g. `diffity open HEAD~3`, `diffity open work`).
2. Tell the user the review is ready and they can check the browser. Report the count per severity and one line per `must-fix` with its location. If the user gave instructions, say how you addressed them. Example:

   > Review complete, check your browser.
   >
   > Found: 2 must-fix, 1 suggestion, 1 nit
   > - `src/auth.ts:42` compares the token expiry in seconds with `Date.now()` in milliseconds
   > - `src/db.ts:17` interpolates the user id into the SQL string
   >
   > When you're ready, run **/diffity-resolve** to fix them.
