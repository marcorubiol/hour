/**
 * PLACES: where a person typed a city, which zone is it in (Travel v2 P2).
 *
 * The zone of a stage's end is KNOWN, not guessed: it comes from the place
 * the person picks among candidates, each with its country and its IANA zone.
 * The data is an offline gazetteer built by `scripts/build-places.mjs` from
 * GeoNames (CC BY 4.0, «GeoNames», geonames.org): `cities500` for the world
 * and every populated place of the touring countries, plus the airports
 * of `airportsdata` (MIT), and served by the Worker (`/api/places`); the
 * client only ever receives the handful of candidates for what it typed.
 *
 * AMBIGUITY IS ASKED, NEVER RESOLVED IN SILENCE: «Valencia» is in Spain and
 * in Venezuela, and the two are different clocks; both are offered, side by
 * side, with their country and zone.
 *
 * Pure and import-free on purpose: the build script runs this same file
 * under Node, so the keys it writes and the keys a search reads are
 * normalised by one function.
 */

/** Lower case, no accents, letters and digits only, single spaces. */
export function normPlace(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The file a text is searched in. The gazetteer is sharded by the first two
 * letters of each name, and a heavy prefix is split one letter longer
 * (`split`, from the build's `index.json`): «sa» is every Saint-… of France,
 * so «sai» and «san» live in files of their own. Null under two letters.
 */
export function shardFor(text: string, split: ReadonlySet<string>): string | null {
  const chars = [...normPlace(text)];
  if (chars.length < 2) return null;
  let len = 2;
  while (split.has(chars.slice(0, len).join('')) && chars.length > len) len++;
  return shardName(chars.slice(0, len).join(''));
}

/** A prefix → its file name: base-36 code points, so any script is safe. */
export function shardName(prefix: string): string {
  return [...prefix].map((ch) => (ch.codePointAt(0) as number).toString(36)).join('-');
}

/** A text that may be an airport code: three letters, or four in capitals. */
export function looksLikeCode(text: string): boolean {
  const s = text.trim();
  return /^[A-Za-z]{3}$/.test(s) || /^[A-Z]{4}$/.test(s);
}

/** One file the Worker loads (a shard, or the airports), column-wise. */
export type PlaceIndex = {
  v: 1;
  zones: string[];
  cities: {
    /** Display name (GeoNames `name`). */
    n: string[];
    /** ISO-2 country. */
    c: string[];
    /** Index into `zones`. */
    z: number[];
    /** Population, for the order. */
    p: number[];
    /** Every normalised name it answers to, `|a|b|c|`. */
    k: string[];
  };
  /** `[iata, icao, name, city, country, zoneIndex]`, only airports with IATA. */
  airports: Array<[string, string, string, string, string, number]>;
};

export type PlaceCandidate = {
  /** A venue of the space (Hour's own `venue`), a place of the gazetteer, or
      an airport. Venues come first: they are where the company is going. */
  kind: 'venue' | 'city' | 'airport';
  /** The city it names (for an airport, the city it serves). */
  city: string;
  /** Null only for a venue nobody gave a country. */
  country: string | null;
  /**
   * The zone. Null only for a venue whose zone is not known (no
   * `venue.timezone`, and its city is not one answer in the gazetteer): that
   * end reads on the space's clock, and the screen says so.
   */
  tz: string | null;
  /** Venue and airport: its name, the stage's `place`. */
  place?: string;
  /** Airport only. */
  code?: string;
  /** Venue only. */
  venueId?: string;
  /** Venue only: where its zone came from (its own field, or its city). */
  tzFrom?: 'venue' | 'city' | null;
  /** The text IS one of its names (not just the start of one): the screen
      keeps the person's own spelling («Alacant», «Londres») instead of ours. */
  exact: boolean;
};

/**
 * Candidates for what a person typed, best first, at most `limit`, across
 * every file of the gazetteer (the world, and one file per touring country).
 *
 * - A three-letter IATA or four-letter ICAO code puts that airport first.
 * - Places match when ANY of their names starts with the text (`Lond` →
 *   London, `Londres` → London, `Valen` → València and Valencia).
 * - An exact name ranks before a prefix; then the countries in `prefer`
 *   (the space's, the previous stage's): an ORDER, never a choice; then
 *   population.
 * - The same name in the same country and zone is listed once (GeoNames has
 *   twenty Saint-Martin in one département). Two different villages of one
 *   country stay two: the field also names WHICH village, not only its clock.
 */
export function searchPlaces(
  indexes: PlaceIndex | readonly PlaceIndex[],
  text: string,
  { limit = 8, prefer = [] }: { limit?: number; prefer?: readonly string[] } = {},
): PlaceCandidate[] {
  const all = Array.isArray(indexes) ? indexes : [indexes as PlaceIndex];
  const q = normPlace(text);
  if (q.length < 2) return [];
  const out: PlaceCandidate[] = [];

  const code = text.trim().toUpperCase();
  if (looksLikeCode(text)) {
    for (const index of all) {
      for (const [iata, icao, name, city, cc, z] of index.airports) {
        if (iata === code || icao === code) {
          out.push({ kind: 'airport', city, country: cc, tz: index.zones[z], place: name, code: iata, exact: false });
        }
      }
    }
  }

  const exact = `|${q}|`;
  const prefix = `|${q}`;
  const hits: Array<{ ix: PlaceIndex; i: number; rank: number; near: number; pop: number }> = [];
  for (const ix of all) {
    const { c, p, k } = ix.cities;
    for (let i = 0; i < k.length; i++) {
      const keys = k[i];
      if (!keys.includes(prefix)) continue;
      hits.push({ ix, i, rank: keys.includes(exact) ? 0 : 1, near: prefer.includes(c[i]) ? 0 : 1, pop: p[i] });
    }
  }
  hits.sort((a, b) => a.rank - b.rank || a.near - b.near || b.pop - a.pop);

  // EVERY CLOCK GETS A SEAT FIRST: twenty Spanish villages called Santiago
  // must not push Santiago de Chile off the list, because that one is the
  // other answer to the question this field asks. So the best of each
  // country-and-zone is taken first, the rest fill what is left, and the
  // list keeps the ranking's order.
  const seen = new Set<string>();
  const clocks = new Set<string>();
  const firsts: number[] = [];
  const rest: number[] = [];
  hits.forEach((h, j) => {
    const { n, c, z } = h.ix.cities;
    const tz = h.ix.zones[z[h.i]];
    const key = `${n[h.i]}|${c[h.i]}|${tz}`;
    if (seen.has(key)) return;
    seen.add(key);
    const clock = `${c[h.i]}|${tz}`;
    if (clocks.has(clock)) rest.push(j);
    else {
      clocks.add(clock);
      firsts.push(j);
    }
  });
  const room = Math.max(0, limit - out.length);
  const picked = [...firsts.slice(0, room), ...rest].slice(0, room).sort((a, b) => a - b);
  for (const j of picked) {
    const { ix, i, rank } = hits[j];
    const { n, c, z } = ix.cities;
    out.push({ kind: 'city', city: n[i], country: c[i], tz: ix.zones[z[i]], exact: rank === 0 });
  }
  return out.slice(0, limit);
}

/** True when the candidates do not all say the same zone: the person must pick. */
export function zonesDiffer(candidates: readonly PlaceCandidate[]): boolean {
  return new Set(candidates.map((x) => x.tz)).size > 1;
}

/** What a stage's end stores once a candidate is picked. */
export type PickedPlace = {
  city: string;
  place: string | null;
  country: string | null;
  /** Null: not known, the space's clock (said on screen). */
  tz: string | null;
  /** The venue of the space this end is, when it is one. */
  venueId?: string | null;
};

/**
 * A candidate picked → the end it writes. A city keeps the person's spelling
 * when it was a whole name («Alacant»), ours when it was only the start of
 * one («Alac» → Alicante). An airport writes its city and its name.
 */
export function pickPlace(typed: string, c: PlaceCandidate): PickedPlace {
  if (c.kind === 'venue') {
    return { city: c.city, place: c.place ?? null, country: c.country, tz: c.tz, venueId: c.venueId ?? null };
  }
  if (c.kind === 'airport') {
    return { city: c.city, place: c.place ?? c.code ?? null, country: c.country, tz: c.tz };
  }
  return { city: c.exact ? typed.trim() : c.city, place: null, country: c.country, tz: c.tz };
}

/**
 * The zone of a city by the gazetteer, only when it is ONE answer: the
 * places whose name is exactly that city (in that country, when it is
 * known) all share a zone. Otherwise null: a venue in «Valencia» with no
 * country and no zone of its own is not resolved in silence.
 */
export function cityZone(
  indexes: PlaceIndex | readonly PlaceIndex[],
  city: string,
  country: string | null,
): string | null {
  const hits = searchPlaces(indexes, city, { limit: 50 }).filter(
    (c) => c.kind === 'city' && c.exact && (!country || c.country === country.toUpperCase()),
  );
  const zones = new Set(hits.map((c) => c.tz));
  return zones.size === 1 ? (hits[0].tz as string) : null;
}

/**
 * Each venue right under the town it is in: same town (its name, or the very
 * name typed when that town matched it whole: «Alacant» is GeoNames'
 * Alicante) and same country when both are known. A venue whose town is not
 * on the list goes right after the first place, so it is still offered.
 */
export function underTheirTown(
  places: readonly PlaceCandidate[],
  venues: readonly PlaceCandidate[],
  typed: string,
): PlaceCandidate[] {
  if (venues.length === 0) return [...places];
  const out: PlaceCandidate[] = [];
  const left = new Set(venues);
  const q = normPlace(typed);
  for (const p of places) {
    out.push(p);
    if (p.kind !== 'city') continue;
    for (const v of venues) {
      if (!left.has(v)) continue;
      const town = normPlace(v.city);
      const sameTown = town === normPlace(p.city) || (p.exact && town === q);
      const sameCountry = !v.country || !p.country || v.country === p.country;
      if (sameTown && sameCountry) {
        out.push(v);
        left.delete(v);
      }
    }
  }
  if (left.size) out.splice(Math.min(1, out.length), 0, ...left);
  return out;
}
