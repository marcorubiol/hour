# `GET /api/engagements`

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
| `status`       | `contacted`    | `engagement_status` enum, or `any` to disable      |
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

- `$lib/auth.ts` — `extractBearer(request)` reads the Authorization header.
- `$lib/supabase.ts` — `pgGet(env, path, jwt, opts)` runs a PostgREST GET;
  `pgPostRpc(env, fn, jwt, args)` calls an RPC. Uses `fetch`; no
  `@supabase/supabase-js` dep, keeps the Worker bundle small.

## Conventions

- Validation at the boundary via Valibot (`v.safeParse`), no manual coercion.
- Error envelope: `{ "error": "<code>", "detail": …, "hint"?: …, "issues"?: [...] }`.
- Never log JWTs or request bodies; Cloudflare keeps Worker logs for 3 days.
