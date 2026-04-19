# API routes — `apps/web/src/pages/api/`

Astro SSR endpoints that run on the `hour-web` Cloudflare Worker. They all
follow the same pattern:

1. Read the caller's JWT from `Authorization: Bearer …`.
2. Forward the call to Supabase PostgREST (`/rest/v1/…`) with that JWT as
   `Authorization` and the anon key as `apikey`.
3. Postgres decides what to return via RLS. **The Worker is not a privilege
   boundary — RLS is.**

## Helpers

- `src/lib/auth.ts` — `extractBearer(request)` reads the Authorization header.
- `src/lib/supabase.ts` — `pgGet(env, path, jwt, opts)` runs a PostgREST GET and
  decodes the JSON body; `pgPostRpc(env, fn, jwt, args)` calls an RPC. Uses
  only `fetch`; no `@supabase/supabase-js` dep.

## Current endpoints

### `GET /api/engagements`

Lists `engagement` rows in the current workspace with the linked `person` and
`project` embedded. RLS + the `current_workspace_id` claim scope visibility;
this endpoint is a thin PostgREST wrapper, no RPC needed.

Anti-CRM vocabulary: replaces the old `/api/prospects`. Default status is
`proposed` (was `prospect`). The filter `difusion-2026-27` is no longer a
project — pass `season=2026-27` (default) to filter engagements by season.

**Query params** (all optional):

| param          | default        | meaning                                            |
|----------------|----------------|----------------------------------------------------|
| `status`       | `proposed`     | `engagement_status` enum, or `any` to disable      |
| `project_slug` | `mamemi`       | project slug inside the current workspace          |
| `season`       | `2026-27`      | matches `custom_fields->>season`, or `any`         |
| `limit`        | `50` (max 100) | page size                                          |
| `offset`       | `0`            | pagination                                         |

**Response**

```json
{
  "total": 156,
  "limit": 50,
  "offset": 0,
  "project_slug": "mamemi",
  "status": "proposed",
  "season": "2026-27",
  "items": [
    {
      "id": "…uuid…",
      "workspace_id": "…",
      "project_id": "…",
      "person_id": "…",
      "date_id": null,
      "status": "proposed",
      "role": null,
      "first_contacted_at": null,
      "last_contacted_at": null,
      "next_action_at": null,
      "next_action_note": null,
      "custom_fields": { "season": "2026-27" },
      "created_at": "2026-04-19T…",
      "updated_at": "2026-04-19T…",
      "created_by": "…",
      "deleted_at": null,
      "person": {
        "id": "…",
        "full_name": "…",
        "email": "…",
        "organization_name": "…",
        "country": "ES",
        "city": "…",
        "website": null
      },
      "project": {
        "id": "…",
        "slug": "mamemi",
        "name": "MaMeMi",
        "type": "show",
        "status": "active"
      }
    }
  ]
}
```

## Testing

The JWT needs a `current_workspace_id` claim for
`public.current_workspace_id()` to resolve. That claim is injected by the
custom access-token hook that reads the caller's `membership` row. Until the
hook is enabled in **Dashboard → Authentication → Hooks**,
`current_workspace_id()` returns NULL and every RLS policy rejects the
request, so the endpoint responds with an empty `items` array (not an error).

### Once auth is live

```bash
# 1. Sign in with a user that has a membership row on the target workspace.
JWT=$(supabase auth sign-in-with-password \
  --email marcorubiol@gmail.com --password … --json | jq -r .access_token)

# 2. Hit the endpoint.
curl -sS "https://hour.zerosense.studio/api/engagements?limit=5" \
  -H "Authorization: Bearer $JWT" | jq
```

### Pre-auth sanity check

You can still prove the query shape from the Supabase SQL editor:

```sql
SELECT e.id, e.status, e.role, e.next_action_at,
       e.custom_fields,
       jsonb_build_object(
         'id', p.id, 'full_name', p.full_name, 'email', p.email,
         'organization_name', p.organization_name,
         'country', p.country, 'city', p.city
       ) AS person,
       jsonb_build_object(
         'id', pr.id, 'slug', pr.slug, 'name', pr.name, 'type', pr.type
       ) AS project
FROM engagement e
JOIN project pr ON pr.id = e.project_id AND pr.slug = 'mamemi'
JOIN person  p  ON p.id  = e.person_id
WHERE e.deleted_at IS NULL
  AND e.status = 'proposed'
  AND e.custom_fields->>'season' = '2026-27'
ORDER BY e.next_action_at ASC NULLS LAST, e.updated_at DESC
LIMIT 5;
```

## Conventions

- Every route sets `export const prerender = false;` — endpoints are always
  SSR, never prerendered.
- Route modules export lowercase HTTP verb functions (`GET`, `POST`, …).
- Error envelope: `{ "error": "<code>", "detail": …, "hint"?: … }`.
- Never log JWTs or request bodies; Cloudflare keeps Worker logs for 3 days.
