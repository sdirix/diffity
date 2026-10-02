---
name: diffity-resolve
description: Read open review comments and resolve them by making code fixes
user-invocable: true
---

# Diffity Resolve Skill

You are reading open review comments and resolving them by making the requested code changes.

## Arguments

- `ref` (optional): The ref whose review comments to resolve (e.g. `main`, `HEAD~3`, `work`). Example: `/diffity-resolve main`
- `thread-id` (optional): Resolve a specific thread by ID instead of all open threads. Example: `/diffity-resolve abc12345`

## CLI Reference

```
diffity agent diff [--ref <ref>]
diffity agent list [--ref <ref>] [--status open|resolved|dismissed] [--json]
diffity agent comment [--ref <ref>] --file <path> --line <n> [--end-line <n>] [--side new|old] [--severity must-fix|suggestion|nit|question] --body "<text>"
diffity agent general-comment [--ref <ref>] --body "<text>"
diffity agent resolve <id> [--ref <ref>] [--summary "<text>"]
diffity agent dismiss <id> [--ref <ref>] [--reason "<text>"]
diffity agent reply <id> [--ref <ref>] --body "<text>"
```

- `--ref` selects the review session. Without it the CLI uses `DIFFITY_SESSION_ID`, else the diff view opened last.
- `--file`, `--line`, `--body` are required for `comment`
- `--line 0` comments on the whole file and takes no `--end-line`
- `--end-line` defaults to `--line` (single-line comment)
- `--side` defaults to `new`
- `general-comment` creates a diff-level comment not tied to any file or line
- `<id>` accepts the full id or a unique prefix of at least 8 characters, from the same session. For a thread of another session the CLI names that session, rerun the command without `--ref` and with `DIFFITY_SESSION_ID=<session-id>` set.

## Prerequisites

1. Check that `diffity` is available: run `which diffity`. If not found, install it with `npm install -g diffity`.
2. Pick the session and use it for every `agent` command below:
   - If a `ref` argument was given, pass `--ref <ref>`.
   - Otherwise, if this conversation already opened or reviewed a ref with diffity, pass that ref (`work` for working tree changes).
   - Otherwise omit `--ref`. The CLI then uses the diff view the user opened last.
3. Check that a review session exists: run `diffity agent list [--ref <ref>]`. If this fails with "No active review session", tell the user to start diffity first (e.g. `diffity` or **/diffity-diff**).

## Instructions

1. List open comment threads with full details:
   ```
   diffity agent list [--ref <ref>] --status open --json
   ```
   If a `thread-id` argument was provided, filter to the thread whose `id` starts with it and use its full `id` from here on. If no thread matches, tell the user it is not open in this session and ask which ref it was left on. The JSON output includes the full comment body, file path, line numbers, and side for each thread.
2. If there are no open threads, tell the user there's nothing to resolve.
3. For each open thread, check the `comments` array and the `author.type` field (`"user"` or `"agent"`) on each comment. Respond to the latest user comment and use earlier comments as context:
   a. **Skip** general comments (filePath `__general__`) started by an agent. These are review summaries, not actionable code changes. General comments started by the user are requests about the whole change: handle them like any other thread.
   b. **Skip** threads where the last comment is from an agent and asks the user a question the user hasn't answered yet (e.g. a "Could you clarify...?" reply or a `[question]` from a review). The agent is waiting for user input. Still process threads where the agent left the original comment (code suggestion, review feedback, etc.). Those are actionable.
   c. **`[nit]` comments** — these are minor suggestions but still actionable. Resolve them like any other comment.
   d. **Questions and discussion** from the user (a `[question]` tag, or comments like "why...?", "is this safe?", "what does this do?"): read the question, examine the relevant code, and reply with an answer grounded in the code you read (cite `path:line`). Do not edit files for it and do not resolve the thread. The user decides when it is done:
      ```
      diffity agent reply <thread-id> [--ref <ref>] --body "Your answer here"
      ```
   e. Questions that ask for a change (e.g. "should we add X?" or "can we rename this?") are requests. Make the change.
   f. Read the comment body from the JSON output and understand what change is requested. Interpret the intent:
      - If the comment suggests a code change, make the change.
      - If the comment suggests adding documentation, add or update the relevant docs.
      - If the comment asks a question that implies an action (e.g. "should we add X?"), treat it as a request to do that action.
      - If the comment is genuinely unclear and you cannot determine what action to take, reply asking for clarification instead of silently skipping:
        ```
        diffity agent reply <thread-id> [--ref <ref>] --body "Could you clarify what change you'd like here?"
        ```
   g. Read the relevant source file to understand the full context around the commented lines (`startLine` 0 means the comment is about the whole file), then make the requested change using the Edit tool. Keep the change minimal and focused on the comment.
   h. Only after the edit landed, resolve the thread with a summary:
      ```
      diffity agent resolve <thread-id> [--ref <ref>] --summary "Fixed: <brief description of what was changed>"
      ```
      Never resolve a thread or write "Fixed:" when the edit failed or the user rejected it. After a rejected edit, stop working on that thread: no retry and no other route to the same change. Reply with the change you proposed, ask how to proceed, and leave the thread open.
   i. Leave exactly one response per thread: a reply, or the resolve summary.
4. After handling all applicable threads, run `diffity agent list [--ref <ref>]` to confirm status.
5. Tell the user what you did: threads resolved, answered and left open, left open after a rejected edit, awaiting clarification, and skipped. Point them to the browser, which shows the new status within 2 seconds.
