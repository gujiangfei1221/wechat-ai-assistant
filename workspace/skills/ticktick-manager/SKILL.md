---
name: ticktick-manager
description: "Manage TickTick (Dida365) tasks and projects via OpenAPI. Use when user asks to create/list/update/complete tasks, manage projects, or sync task status with TickTick. Requires OAuth access token and API credentials."
---

# TickTick Manager Skill

Operate TickTick through Dida365 OpenAPI with secure token-based calls.

## Prerequisites

Set these environment variables before making API calls:

```bash
export TICKTICK_ACCESS_TOKEN="<oauth-access-token>"
export TICKTICK_BASE_URL="https://api.dida365.com/open/v1" # optional
```

Optional (only for OAuth refresh flow):

```bash
export TICKTICK_CLIENT_ID="<client-id>"
export TICKTICK_CLIENT_SECRET="<client-secret>"
export TICKTICK_REDIRECT_URI="<redirect-uri>"
export TICKTICK_REFRESH_TOKEN="<refresh-token>"
export TICKTICK_OAUTH_BASE_URL="https://dida365.com" # optional
```

## Core Rules

- Always prefer `scripts/ticktick_api.py` for deterministic calls.
- Never print full tokens in output; mask with `***` if needed.
- If API returns 401, ask user to refresh OAuth token first.
- If endpoint mismatch happens, inspect `references/openapi-notes.md` and then adjust endpoint.

## Common Workflows

### 1) List projects

```bash
python3 workspace/skills/ticktick-manager/scripts/ticktick_api.py list-projects
```

### 2) List tasks in a project

```bash
python3 workspace/skills/ticktick-manager/scripts/ticktick_api.py list-tasks --project-id <projectId>
```

### 3) Create a task

```bash
python3 workspace/skills/ticktick-manager/scripts/ticktick_api.py create-task \
  --project-id <projectId> \
  --title "提交周报" \
  --content "包含本周进展、风险、下周计划" \
  --due "2026-02-25T10:00:00+08:00"
```

### 4) Mark a task as completed

```bash
python3 workspace/skills/ticktick-manager/scripts/ticktick_api.py complete-task --project-id <projectId> --task-id <taskId>
```

### 5) Update a task

```bash
python3 workspace/skills/ticktick-manager/scripts/ticktick_api.py update-task \
  --task-id <taskId> \
  --title "更新后的标题" \
  --content "补充说明" \
  --due "2026-02-26T18:00:00+08:00" \
  --priority 3
```

### 6) Delete a task

```bash
python3 workspace/skills/ticktick-manager/scripts/ticktick_api.py delete-task --project-id <projectId> --task-id <taskId>
```

### 7) Refresh OAuth token

```bash
python3 workspace/skills/ticktick-manager/scripts/oauth_refresh_token.py
```

Auto-write refreshed token(s) into `.env`:

```bash
python3 workspace/skills/ticktick-manager/scripts/oauth_refresh_token.py --write-env
```

Use custom env file path:

```bash
python3 workspace/skills/ticktick-manager/scripts/oauth_refresh_token.py --write-env --env-file /path/to/.env
```

After refresh, update `TICKTICK_ACCESS_TOKEN` (and `TICKTICK_REFRESH_TOKEN` if returned) in your shell or `.env`.

## Error Handling

- `401 Unauthorized`: Access token expired/invalid.
- `403 Forbidden`: App lacks required scope.
- `404 Not Found`: projectId/taskId invalid or endpoint differs.
- `429 Too Many Requests`: retry with backoff.

## References

- API notes: `references/openapi-notes.md`
- Official docs: https://developer.dida365.com/docs#/openapi
