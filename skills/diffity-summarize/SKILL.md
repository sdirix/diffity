---
name: diffity-summarize
description: Summarize the current diff for a reviewer and post it as a general comment
user-invocable: true
---

# Diffity Summarize Skill

You are summarizing a diff for a reviewer and posting the summary as a general comment in the diffity viewer.

## Arguments

- `ref` (optional): Git ref to summarize (e.g. `main..feature`, `HEAD~3`) or a GitHub PR URL. Defaults to working tree changes.

## CLI Reference

```
diffity agent diff --ref <ref>
diffity agent list --ref <ref> [--status open|resolved|dismissed] [--json]
diffity agent general-comment --ref <ref> --body "<text>"
diffity agent dismiss <id> --ref <ref> [--reason "<text>"]
```

- `--ref` selects the review session. Pass the same ref to every `agent` command. Without it the CLI uses `DIFFITY_SESSION_ID`, else the diff view opened last, which can be a different ref.
- `general-comment` creates a diff-level comment not tied to any file or line. The body is rendered as markdown.
- `<id>` accepts the full id or a unique prefix of at least 8 characters, from the same session

## Prerequisites

1. Check that `diffity` is available: run `which diffity`. If not found, install it with `npm install -g diffity`.

## Instructions

### Step 1: Pick the ref and ensure diffity is running (without opening browser)

1. Settle on one ref string and pass it as `--ref <ref>` to every `agent` command and to `diffity open`:
   - No ref requested: `work`
   - Natural language: the matching git ref (e.g. "last 3 commits" is `HEAD~3`)
   - GitHub PR URL: `origin/<base branch>`, with the base branch from `gh pr view <pr-url> --json baseRefName --jq .baseRefName`
2. Run `diffity list --json` and find the entry whose `repoRoot` matches the current repo. One instance serves every ref of its repo.
3. If no instance is running for this repo, run `diffity --no-open <ref>` (or `diffity --no-open` if no ref) using the Bash tool with `run_in_background: true`. Flags go before the ref. Wait 2 seconds, then verify with `diffity list --json`.
4. For a GitHub PR URL, run `diffity --no-open <pr-url>` in the background instead, whether or not an instance is running. It checks out the PR branch and fetches the base branch.

### Step 2: Understand the change

1. Get the unified diff:
   ```
   diffity agent diff --ref <ref>
   ```
2. Read the commit messages of the range (`git log --oneline <range>`) when they add context.
3. Read enough of the surrounding code to understand the intent, not just the text of the hunks.

### Step 3: Write the summary

Use these sections, in this order:

- **Overview**: One or two sentences on what the change does and why.
- **Changes by area**: Group files by area (e.g. backend, frontend, tests, config, docs). For each area, bullet the meaningful changes with file paths. Collapse mechanical changes (renames, formatting) into a single line.
- **Behavior changes**: Anything user visible, API or contract changes, migrations, new config or dependencies. Leave the section out when there are none.
- **Worth a closer look**: Risky or subtle spots a reviewer should focus on, with `path:line`.

Be concise and factual. No filler, no praise. Do not leave inline comments and do not edit files.

### Step 4: Post the summary

1. Run `diffity agent list --ref <ref> --status open --json`. If an open general comment from an agent starts with `**Summary**`, it is an earlier summary. Dismiss it so only the current one stays open:
   ```
   diffity agent dismiss <id> --ref <ref> --reason "Replaced by a new summary"
   ```
2. Post the summary as a general comment. Start the body with `**Summary**` and pass it through a quoted heredoc so backticks and `$` stay literal. The closing `EOF` has to start its line:
   ```
   diffity agent general-comment --ref <ref> --body "$(cat <<'EOF'
   **Summary**

   <overview>

   **Changes by area**
   - ...
   EOF
   )"
   ```
3. Open the browser: `diffity open <ref>` with the same ref as in Step 1.
4. Tell the user the summary is posted. Repeat the overview and the **Worth a closer look** items, nothing else. Example:

   > Summary posted, check your browser.
   >
   > Adds a discount step to checkout and fixes the total loop.
   > - `src/cart.ts:42` rounds before applying the discount
   >
   > Run **/diffity-review** for a full review.
