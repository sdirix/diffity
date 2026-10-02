---
name: diffity-resolve-tree
description: Read open comments from the tree browser and resolve them by making code fixes
user-invocable: true
---

# Diffity Resolve Tree Skill

You are reading open comments left on repository files via the `diffity tree` browser and resolving them by making the requested code changes.

## Arguments

- `thread-id` (optional): Resolve a specific thread by ID instead of all open threads. Example: `/diffity-resolve-tree abc12345`

## CLI Reference

```
diffity agent list --ref __tree__ [--status open|resolved|dismissed] [--json]
diffity agent comment --ref __tree__ --file <path> --line <n> [--end-line <n>] [--severity must-fix|suggestion|nit|question] --body "<text>"
diffity agent resolve <id> --ref __tree__ [--summary "<text>"]
diffity agent dismiss <id> --ref __tree__ [--reason "<text>"]
diffity agent reply <id> --ref __tree__ --body "<text>"
```

- `--ref __tree__` selects the file browser session. Pass it to every `agent` command. Without it the CLI uses the diff view opened last.
- `--file`, `--line`, `--body` are required for `comment`
- `--line 0` comments on the whole file and takes no `--end-line`
- `--end-line` defaults to `--line` (single-line comment)
- `<id>` accepts the full id or a unique prefix of at least 8 characters, from the same session

## Prerequisites

1. Check that `diffity` is available: run `which diffity`. If not found, install it with `npm install -g diffity`.

## Instructions

1. List open comment threads with full details:
   ```
   diffity agent list --ref __tree__ --status open --json
   ```
   If a `thread-id` argument was provided, filter to the thread whose `id` starts with it and use its full `id` from here on. If no thread matches, tell the user it is not open in the file browser. The JSON output includes the full comment body, file path, line numbers, and side for each thread.
2. If there are no open threads, tell the user there's nothing to resolve.
3. For each open thread, check the `comments` array and the `author.type` field (`"user"` or `"agent"`) on each comment. Respond to the latest user comment and use earlier comments as context:
   a. **Skip** general comments (filePath `__general__`) started by an agent. These are summaries, not actionable code changes. General comments started by the user are requests: handle them like any other thread.
   b. **Skip** threads where the last comment is from an agent and asks the user a question the user hasn't answered yet. The agent is waiting for user input.
   c. **Questions and discussion** from the user (a `[question]` tag, or comments like "why...?", "is this safe?", "what does this do?"): read the question, examine the relevant code, and reply with an answer grounded in the code you read (cite `path:line`). Do not edit files for it and do not resolve the thread. The user decides when it is done:
      ```
      diffity agent reply <thread-id> --ref __tree__ --body "Your answer here"
      ```
   d. Questions that ask for a change (e.g. "should we add X?" or "can we rename this?") are requests. Make the change. `[nit]` comments are minor but still actionable.
   e. Read the comment body from the JSON output and understand what change is requested. The comment is anchored to a specific file and line range, or to a whole file or folder when `filePath` is `__path__:<path>`. Read the full file to understand context:
      - If the comment suggests a code change, refactor, or improvement, make the change.
      - If the comment suggests adding documentation, add or update the relevant docs.
      - If the comment is genuinely unclear, reply asking for clarification:
        ```
        diffity agent reply <thread-id> --ref __tree__ --body "Could you clarify what change you'd like here?"
        ```
   f. Keep the change minimal and focused on the comment. Only after the edit landed, resolve the thread with a summary:
      ```
      diffity agent resolve <thread-id> --ref __tree__ --summary "Fixed: <brief description of what was changed>"
      ```
      Never resolve a thread or write "Fixed:" when the edit failed or the user rejected it. After a rejected edit, stop working on that thread: no retry and no other route to the same change. Reply with the change you proposed, ask how to proceed, and leave the thread open.
   g. Leave exactly one response per thread: a reply, or the resolve summary.
4. After handling all applicable threads, run `diffity agent list --ref __tree__` to confirm status.
5. Tell the user what you did: threads resolved, answered and left open, left open after a rejected edit, awaiting clarification, and skipped. Point them to the browser, which shows the new status within 2 seconds.
