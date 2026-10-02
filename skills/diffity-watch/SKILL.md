---
name: diffity-watch
description: Listen for requests from the diffity browser and handle them in this session
user-invocable: true
---

# Diffity Watch Skill

You take the requests the user sends from the diffity browser and handle them in this session, with the context you already have. Requests come from the Review, Send and Ask Agent buttons and from comments that mention `@claude` or `@agent`. diffity does not start an agent of its own, it queues the requests until you take them.

## CLI Reference

```
diffity agent wait --json [--timeout <seconds>]
diffity agent progress <request-id> "<text>"
diffity agent done <request-id> --summary "<text>"
diffity agent requests [--json]
```

- `wait` blocks until a request is queued, claims it and prints it as JSON. Its `instructions` field says what to do. It exits 0 with a request, or 75 with `"timeout": true` when none came within the timeout (50 minutes by default).
- While a `wait` runs, the browser shows the agent as listening.
- `progress` shows a line in the browser while you work. `done` closes the request with a summary.
- `requests` lists the recent requests and whether an agent waits.

## Prerequisites

1. Check that `diffity` is available: run `which diffity`. If not found, install it with `npm install -g diffity`.
2. Requests come from the browser, so the user needs diffity open for this repo. `wait` itself does not need it.

## Instructions

### Step 1: Wait in the background

1. From the repository, start `diffity agent wait --json` as a **background** command, so its exit wakes you up:
   - Claude Code: the Bash tool with `run_in_background: true`. When the command exits, Claude Code tells you and you continue with Step 2.
   - Other agents: their way to run a command in the background and get notified when it exits. Without one, tell the user that this agent cannot listen and stop.
2. Never run `wait` in the foreground. It blocks the session for up to 50 minutes.
3. Run one `wait` at a time. Do not start another while one runs.
4. Tell the user in one line that you are listening, for example "Listening for diffity requests. Say stop to end." Then end your turn. Do not poll the output and do not sleep.

### Step 2: Handle what `wait` returned

1. **Timeout** (exit code 75, `"timeout": true`): start the same background `wait` again and end your turn without a message.
2. **A request** (exit code 0): the JSON has the request's `id`, `mode`, `sessionId`, `ref`, `threadIds`, `note`, `focus` and `paths`, and the `instructions`. Follow the instructions:
   - Run every `diffity agent` command for the request with `DIFFITY_SESSION_ID=<sessionId>` in front and without `--ref`, so it works on the view the user sent it from.
   - Apply the rules of the skill the instructions name, but skip its setup steps (picking a ref, starting diffity, opening the browser):

     | `mode` | Rules |
     | --- | --- |
     | `review` | **/diffity-review** from Step 2, with the user's `focus` first and only the `paths` when given |
     | `resolve` | **/diffity-resolve** for just the `threadIds`, **/diffity-resolve-tree** for the file browser (`ref` `__tree__`) |
     | `thread` | **/diffity-resolve** for the one thread: answer a question in the thread, make a requested change and resolve it |
     | `summarize` | **/diffity-summarize** from Step 2 |

   - Take the `note` into account for every thread of the request.
   - For work that takes longer than a minute, report progress after each larger step: `diffity agent progress <id> "<what you are doing>"`.
3. **Any other exit code**: show the user the error and stop listening.

### Step 3: Finish and wait again

1. Mark the request done with a one line summary, which the browser shows: `diffity agent done <id> --summary "<what you did>"`. Mark it done also when you could not do it, and say why in the summary.
2. Start the next background `wait` right away, as in Step 1.
3. Tell the user in a few lines what you did, then end your turn.

## Stopping

Keep listening until the user says to stop. Then stop the background `wait` that runs (in Claude Code, stop its background task) and do not start another. Requests sent later wait in the queue until you listen again.
