# `GET /api/conversations`

SvelteKit `+server.ts` endpoint that runs on the `hour-web` Cloudflare Worker.
Thin PostgREST wrapper — RLS + the `current_workspace_id` JWT claim are the
privilege boundary, not the Worker.

## Auth

Bearer JWT required. The endpoint reads it from `Authorization: Bearer <jwt>`.

The JWT must carry a `current_workspace_id` claim, injected by Supabase's
`custom_access_token_hook` (enabled in **Authentication → Hooks**). Without the
hook, `current_workspace_id()` returns NULL in Postgres and every RLS policy
denies the request, so the endpoint returns an empty `items` array (not an
error).

## Query params (validated with Valibot)

| param          | default        | meaning                                            |
|----------------|----------------|----------------------------------------------------|
| `status`       | `contacted`    | `conversation_status` enum, or `any` to disable      |
| `project_slug` | `mamemi`       | project slug inside the current workspace          |
| `season`       | `2026-27`      | matches `custom_fields->>season`, or `any`         |
| `limit`        | `50` (max 100) | page size                                          |
| `offset`       | `0`            | pagination                                         |

Invalid values return `400 invalid_query` with per-field issues from Valibot.

## Response

```json
{
  "total": 154,
  "limit": 50,
  "offset": 0,
  "project_slug": "mamemi",
  "status": "contacted",
  "season": "2026-27",
  "items": [
    {
      "id": "…uuid…",
      "status": "contacted",
      "next_action_at": null,
      "person": { "full_name": "…", "organization_name": "…", "country": "ES", "city": "…" },
      "project": { "id": "…", "slug": "mamemi", "name": "MaMeMi", "status": "active" }
    }
  ]
}
```

## Helpers

- `$lib/auth.ts` — `extractAccessToken(request)` reads the Authorization header.
- `$lib/supabase.ts` — `pgGet(env, path, jwt, opts)` runs a PostgREST GET;
  `pgPostRpc(env, fn, jwt, args)` calls an RPC. Uses `fetch`; no
  `@supabase/supabase-js` dep, keeps the Worker bundle small.

## Conventions

- Validation at the boundary via Valibot (`v.safeParse`), no manual coercion.
- Error envelope: `{ "error": "<code>", "detail": …, "hint"?: …, "issues"?: [...] }`.
- Never log JWTs or request bodies; Cloudflare keeps Worker logs for 3 days.

## `PATCH /api/conversations/:id`

The inline editor accepts `status`, `next_action_at`, `next_action_note` and
`line_id`. It never accepts a contact timestamp. A genuine status transition
updates `last_contacted_at` (database trigger); the database fills
`first_contacted_at` once and preserves it thereafter.

## `GET` / `POST /api/conversations/:id/events` (ADR-098)

The history of a conversation (`conversation_event`, contract in
`build/conversation-event-contract.md`). `GET` lists the events, most recent
first; a conversation the caller cannot read yields an empty list, never a
404 that would confirm it exists. `POST` takes `{ kind, direction?, body?,
occurred_at? }` and goes through `record_conversation_event`, gated on
`edit:conversation`; without `occurred_at` the server stamps now. Every kind
except a note without a direction moves `last_contacted_at` to the latest
contact in the same transaction. The log is append-only: no edit, no delete.
