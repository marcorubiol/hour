/**
 * /api/places?q=…&prefer=ES,FR — candidates for a place a person typed, each
 * with its country and its IANA zone (Travel v2 P2: a stage's zone is KNOWN
 * from the place picked, never guessed). See `$lib/places`.
 *
 * The gazetteer (~37 MB in ~2,900 shards of ≤200 KB: GeoNames cities500 for
 * the world, every populated place of the touring countries, and the
 * airports) lives in R2, in the MEDIA bucket under `places/v1/` (Marco,
 * 2026-10-10: not in the repo). `scripts/build-places.mjs` builds it into
 * `.cache/places/` and `scripts/upload-places.sh` puts it there. A search
 * reads ONE shard (the prefix of what was typed) and, for a code, the
 * airports; each file is kept in the isolate's memory once read. Nothing
 * leaves for a third party: the cities of a tour stay between the browser
 * and Hour.
 *
 * `prefer` orders, never chooses: the countries the screen already knows
 * (the space's, the stage before) come first among equals.
 *
 * `workspace_id` adds the space's own VENUES (Marco, 2026-10-10): the ones
 * whose NAME has the text go first, and the ones IN a town go right under
 * that town (typing «Alacant» offers Alacant, and under it its theatre). A venue's zone is its
 * `timezone` (ADR-053); without one, its city's zone when the gazetteer gives
 * ONE answer for it (`cityZone`); without that, null, and the screen says the
 * end reads on the space's clock. Venues are read with the session's JWT, so
 * RLS shows only the venues this person can see.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { dev } from '$app/environment';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import {
  cityZone,
  looksLikeCode,
  searchPlaces,
  shardFor,
  underTheirTown,
  type PlaceCandidate,
  type PlaceIndex,
} from '$lib/places';

const QuerySchema = v.object({
  q: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(80)),
  prefer: v.optional(v.pipe(v.string(), v.regex(/^([A-Z]{2})(,[A-Z]{2}){0,4}$/))),
  workspace_id: v.optional(v.pipe(v.string(), v.uuid())),
});

type VenueRow = { id: string; name: string; city: string | null; country: string | null; timezone: string | null };

/** Where the index lives in the bucket. A new build gets a new version. */
const PREFIX = 'places/v1/';

type Bucket = { get(key: string): Promise<{ text(): Promise<string> } | null> };

/** Files already read in this isolate (a shard is read once, then kept). */
const files = new Map<string, Promise<unknown>>();

/**
 * DEV ONLY: `vite dev` runs the platform proxy with an empty, in-memory R2,
 * so the index is read from the build's own output on disk instead. `dev`
 * is a build-time constant: this branch, and its `node:fs`, are not in the
 * Worker that ships.
 */
async function fromDisk(name: string): Promise<string | null> {
  if (!dev) return null;
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  try {
    return await readFile(resolve(process.cwd(), '../../.cache/places', name), 'utf8');
  } catch {
    return null;
  }
}

/** One file of the gazetteer, from R2 (or, in dev, from disk). Null when it is not there. */
function asset<T>(name: string, bucket?: Bucket): Promise<T | null> {
  let p = files.get(name);
  if (!p) {
    p = (async () => {
      const obj = bucket ? await bucket.get(PREFIX + name) : null;
      const text = obj ? await obj.text() : await fromDisk(name);
      return text === null ? null : JSON.parse(text);
    })().catch((err) => {
      files.delete(name);
      throw err;
    });
    files.set(name, p);
  }
  return p as Promise<T | null>;
}

function json(body: unknown, status = 200, cache = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(cache ? { 'cache-control': 'private, max-age=86400' } : {}),
    },
  });
}

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  const parsed = v.safeParse(QuerySchema, Object.fromEntries(url.searchParams));
  if (!parsed.success) return json({ places: [] });
  const { q, prefer, workspace_id } = parsed.output;
  const bucket = platform?.env?.MEDIA as Bucket | undefined;
  try {
    const index = await asset<{ split: string[] }>('index.json', bucket);
    const split = new Set(index?.split ?? []);
    /** The gazetteer files a text is searched in. */
    const partsFor = async (text: string, codes: boolean) => {
      const shard = shardFor(text, split);
      const [cities, airports] = await Promise.all([
        shard ? asset<PlaceIndex>(`s/${shard}.json`, bucket) : null,
        codes && looksLikeCode(text) ? asset<PlaceIndex>('airports.json', bucket) : null,
      ]);
      return [airports, cities].filter((x): x is PlaceIndex => x !== null);
    };

    const env = platform?.env as unknown as SupabaseEnv | undefined;
    const [places, byName, inTown] = await Promise.all([
      partsFor(q, true).then((parts) => searchPlaces(parts, q, { prefer: prefer ? prefer.split(',') : [] })),
      workspace_id && env ? venuesOf(env, jwt, workspace_id, q, 'name') : Promise.resolve([] as VenueRow[]),
      workspace_id && env ? venuesOf(env, jwt, workspace_id, q, 'city') : Promise.resolve([] as VenueRow[]),
    ]);

    const asCandidate = async (ven: VenueRow): Promise<PlaceCandidate> => {
      let tz = ven.timezone;
      let tzFrom: PlaceCandidate['tzFrom'] = tz ? 'venue' : null;
      if (!tz && ven.city) {
        tz = cityZone(await partsFor(ven.city, false), ven.city, ven.country);
        tzFrom = tz ? 'city' : null;
      }
      return {
        kind: 'venue',
        city: ven.city ?? ven.name,
        country: ven.country ? ven.country.toUpperCase() : null,
        tz,
        tzFrom,
        place: ven.name,
        venueId: ven.id,
        exact: false,
      };
    };
    const named = await Promise.all(byName.map(asCandidate));
    const seen = new Set(byName.map((v) => v.id));
    const townVenues = await Promise.all(inTown.filter((v) => !seen.has(v.id)).map(asCandidate));
    // Only the gazetteer's answer is cached: a venue created or renamed today
    // must show up today.
    return json({ places: [...named, ...underTheirTown(places, townVenues, q)] }, 200, !workspace_id);
  } catch {
    return json({ error: 'places_unavailable' }, 503);
  }
};

/**
 * The space's venues whose NAME has the text, or that are IN a town whose
 * name starts with it, as RLS lets this person see them.
 */
async function venuesOf(
  env: SupabaseEnv,
  jwt: string,
  workspaceId: string,
  q: string,
  by: 'name' | 'city',
): Promise<VenueRow[]> {
  const safe = q.replace(/[%_*,()]/g, ' ').trim();
  if (!safe) return [];
  const search = new URLSearchParams();
  search.set('select', 'id,name,city,country,timezone');
  search.set('workspace_id', `eq.${workspaceId}`);
  search.set('deleted_at', 'is.null');
  if (by === 'name') search.set('name', `ilike.*${safe}*`);
  else search.set('city', `ilike.${safe}*`);
  search.set('order', 'name.asc');
  search.set('limit', by === 'name' ? '4' : '6');
  try {
    const { data } = await pgGet<VenueRow>(env, 'venue', jwt, { search });
    return data;
  } catch {
    // Venues are a help, not the answer: the gazetteer still answers.
    return [];
  }
}
