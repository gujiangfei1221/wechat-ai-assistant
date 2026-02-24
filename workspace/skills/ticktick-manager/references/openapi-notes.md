# Dida365 / TickTick OpenAPI Notes

This reference is for quick implementation and troubleshooting.

## Base URL

- Recommended: `https://api.dida365.com/open/v1`

## Auth

Use OAuth 2.0 Bearer token:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

## Frequently Used Endpoints

> Endpoint naming may evolve; verify against official docs if errors occur.

- List projects: `GET /project`
- Get project details and task data: `GET /project/{projectId}/data`
- Create task: `POST /task`
- Update task: `POST /task/{taskId}`
- Complete task: `POST /project/{projectId}/task/{taskId}/complete`
- Delete task: `DELETE /project/{projectId}/task/{taskId}`

## OAuth Refresh

- Token endpoint: `POST https://dida365.com/oauth/token`
- Content-Type: `application/x-www-form-urlencoded`
- Parameters: `client_id`, `client_secret`, `grant_type=refresh_token`, `refresh_token`, `redirect_uri`

## Task Fields (common)

- `projectId` (string)
- `title` (string, required)
- `content` (string, optional)
- `dueDate` (RFC3339 datetime string, optional)
- `priority` (number, optional)

## Practical Tips

- Always start with listing projects to find the correct `projectId`.
- Use ISO/RFC3339 datetime with timezone, e.g. `2026-02-25T10:00:00+08:00`.
- Keep payload minimal first (`title`, `projectId`), then add optional fields.
- Log status code and response body for debugging.
