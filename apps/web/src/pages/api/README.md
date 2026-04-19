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
  decodes the JSON body. Uses only `fetch`; no `@supabase/supabase-js` dep.

## Current endpoints

### `GET /api/prospects`

Smoke endpoint that exercises RLS + the funnel join. Returns
`contact_project` rows flattened for a list/table view.

**Query params** (all optional):

| param          | default              | meaning                                    |
|----------------|----------------------|--------------------------------------------|
| `status`       | `prospect`           | contact_project_status enum                |
| `project_slug` | `difusion-2026-27`   | project slug in current org                |
| `limit`        | `50` (max 100)       | page size                                  |
| `offset`       | `0`                  | pagination                                 |

**Response**

```json
{
  "total": 156,
  "limit": 50,
  "offset": 0,
  "project_slug": "difusion-2026-27",
  "status": "prospect",
  "items": [
    {
      "contact_id": "…uuid…",
      "name": "…",
      "company": "…",
      "email": "…",
      "country": "ES",
      "city": "…",
      "website": "…",
      "status": "prospect",
      "role_label": null,
      "updated_at": "2026-04-19T…",
      "tags": ["procedencia:catalunya", "src:mostra-igualada-2026", "tipologia:programador"],
      "source_mostra_registre": "133"
    }
  ]
}
```

## Testing

The JWT needs a `current_org_id` claim for `public.current_org_id()` to
resolve. Supabase does not emit that claim out of the box — it has to come
from a custom access-token hook that reads from `membership`. Until that hook
is wired, `current_org_id()` returns NULL and every RLS policy rejects you,
so the endpoint will respond with an empty `items` array (not an error).

### Once auth is live

```bash
# 1. Sign in (or request a magic link) with a user that has a membership row.
JWT=$(supabase auth sign-in-with-password \
  --email you@mamemi.cat --password … --json | jq -r .access_token)

# 2. Hit the endpoint.
curl -sS "https://hour.zerosense.studio/api/prospects?limit=5" \
  -H "Authorization: Bearer $JWT" | jq
```

### Pre-auth sanity check

You can still prove the query shape from the Supabase SQL editor:

```sql
-- Same select the endpoint runs — bypasses RLS because you're in the studio.
SELECT cp.status, cp.role_label, cp.updated_at,
       to_jsonb(c) - 'organization_id' AS contact,
       (SELECT jsonb_agg(t.name ORDER BY t.name)
        FROM tagging tg JOIN tag t ON t.id = tg.tag_id
        WHERE tg.entity_type='contact' AND tg.entity_id=c.id) AS tags
FROM contact_project cp
JOIN project p ON p.id = cp.project_id AND p.slug = 'difusion-2026-27'
JOIN contact c ON c.id = cp.contact_id
WHERE cp.status = 'prospect'
ORDER BY cp.updated_at DESC
LIMIT 5;
```

## Conventions

- Every route sets `export const prerender = false;` — endpoints are always
  SSR, never prerendered.
- Route modules export lowercase HTTP verb functions (`GET`, `POST`, …).
- Error envelope: `{ "error": "<code>", "detail": …, "hint"?: … }`.
- Never log JWTs or request bodies; Cloudflare keeps Worker logs for 3 days.
