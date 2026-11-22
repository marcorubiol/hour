/**
 * Fase 0 · Prueba técnica CalDAV en Cloudflare Workers (workerd).
 *
 * Solo se ejecuta en local (`wrangler dev`) desde `scripts/caldav-probe/run.mjs`.
 * Nunca se despliega ni registra credenciales. Comprueba los 7 pasos reales
 * contra iCloud (o contra el mock local en `--mock`):
 *   1. PROPFIND / → current-user-principal
 *   2. PROPFIND principal → calendar-home-set
 *   3. MKCALENDAR → crea calendario temporal «Hour · prueba fase 0»
 *   4. PUT → escribe VEVENT con TZID=Europe/Madrid, VALARM (-PT2H), SEQUENCE:0
 *   5. REPORT sync-collection (sin token) → comprueba si devuelve sync-token
 *   6. PUT (SEQUENCE:1) + REPORT sync-collection (con sync-token) → delta real
 *   7. DELETE evento + DELETE calendario temporal (en finally)
 */

const XML_HEADERS = {
  'content-type': 'application/xml; charset=utf-8',
};

function basicAuth(appleId, appPassword) {
  const bytes = new TextEncoder().encode(`${appleId}:${appPassword}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

/** Extrae el primer <href> dentro de un bloque XML que contenga `tagName`. */
function extractTagHref(xml, tagName) {
  const blockRe = new RegExp(`<(?:[a-z0-9_-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${tagName}>`, 'i');
  const block = blockRe.exec(xml);
  if (!block) return null;
  const href = /<(?:[a-z0-9_-]+:)?href\b[^>]*>([^<]+)<\/(?:[a-z0-9_-]+:)?href>/i.exec(block[1]);
  return href ? href[1].trim() : null;
}

function extractTextTag(xml, tagName) {
  const re = new RegExp(`<(?:[a-z0-9_-]+:)?${tagName}\\b[^>]*>([^<]+)<\\/(?:[a-z0-9_-]+:)?${tagName}>`, 'i');
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

function extractAllHrefs(xml) {
  const out = [];
  const re = /<(?:[a-z0-9_-]+:)?href\b[^>]*>([^<]+)<\/(?:[a-z0-9_-]+:)?href>/gi;
  let m;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

function resolveUrl(base, href) {
  return new URL(href, base).toString();
}

function buildProbeIcs(uid, sequence) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hour//CalDAV Phase0 Probe//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    'DTSTART;TZID=Europe/Madrid:20261215T160000',
    'DTEND;TZID=Europe/Madrid:20261215T220000',
    `SUMMARY:Hour · Prueba fase 0 (seq ${sequence})`,
    'LOCATION:Teatre de prova\\, Barcelona',
    'DESCRIPTION:carga 16h\\nfunción 20h\\nEn Hour: https://hour.zerosense.studio',
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    `SEQUENCE:${sequence}`,
    `LAST-MODIFIED:${now}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT2H',
    'DESCRIPTION:Hour · Prueba fase 0',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

async function dav(url, { method, auth, headers = {}, body }) {
  const t0 = Date.now();
  let currentUrl = url;
  const hops = [];

  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(currentUrl, {
      method,
      headers: {
        authorization: auth,
        'user-agent': 'Hour-CalDAV-Probe/0.1',
        ...headers,
      },
      body,
      redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) {
        const nextUrl = new URL(location, currentUrl);
        const currHost = new URL(currentUrl).hostname;
        // Re-attach Basic auth only on same host or *.icloud.com shard redirects.
        const allowed =
          nextUrl.hostname === currHost ||
          (nextUrl.protocol === 'https:' && nextUrl.hostname.endsWith('.icloud.com'));
        if (allowed) {
          hops.push({ status: res.status, host: nextUrl.hostname });
          currentUrl = nextUrl.toString();
          continue;
        }
      }
    }

    const text = await res.text();
    return {
      status: res.status,
      ok: res.ok || res.status === 207,
      url: currentUrl,
      etag: res.headers.get('etag'),
      wwwAuth: res.headers.get('www-authenticate'),
      hops,
      ms: Date.now() - t0,
      text,
    };
  }

  return {
    status: 508,
    ok: false,
    url: currentUrl,
    etag: null,
    wwwAuth: null,
    hops,
    ms: Date.now() - t0,
    text: 'too_many_redirects',
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, runtime: 'workerd' });
    }
    if (request.method !== 'POST' || url.pathname !== '/probe') {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }

    const baseUrl = String(input.baseUrl || 'https://caldav.icloud.com/');
    const appleId = String(input.appleId || '').trim();
    const appPassword = String(input.appPassword || '').trim();
    if (!appleId || !appPassword) {
      return Response.json({ error: 'missing_credentials' }, { status: 400 });
    }

    const credShape = {
      matchesAppPasswordPattern: /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(appPassword),
      length: appPassword.length,
      looksHexEncoded: appPassword.length >= 20 && /^[0-9a-f]+$/i.test(appPassword),
    };

    const auth = basicAuth(appleId, appPassword);
    const steps = [];
    const probeSlug = `hour-probe-${crypto.randomUUID().slice(0, 8)}`;
    const uid = `${probeSlug}@hour.zerosense.studio`;
    let calendarUrl = null;
    let eventUrl = null;

    const record = (name, r, extra = {}) => {
      steps.push({
        step: name,
        status: r.status,
        ok: r.ok,
        ms: r.ms,
        ...(r.hops?.length ? { hops: r.hops } : {}),
        ...(!r.ok && r.wwwAuth ? { wwwAuth: r.wwwAuth } : {}),
        ...extra,
      });
    };

    try {
      // 1. Discover current-user-principal
      const p1 = await dav(baseUrl, {
        method: 'PROPFIND',
        auth,
        headers: { ...XML_HEADERS, depth: '0' },
        body:
          '<?xml version="1.0" encoding="utf-8"?>' +
          '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
      });
      const principalHref = extractTagHref(p1.text, 'current-user-principal');
      record('1_propfind_principal', p1, { found: Boolean(principalHref) });
      if (!p1.ok || !principalHref) {
        return Response.json({ ok: false, failedAt: '1_propfind_principal', credShape, steps }, { status: 200 });
      }
      const principalUrl = resolveUrl(p1.url, principalHref);

      // 2. Discover calendar-home-set
      const p2 = await dav(principalUrl, {
        method: 'PROPFIND',
        auth,
        headers: { ...XML_HEADERS, depth: '0' },
        body:
          '<?xml version="1.0" encoding="utf-8"?>' +
          '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
          '<d:prop><c:calendar-home-set/></d:prop></d:propfind>',
      });
      const homeHref = extractTagHref(p2.text, 'calendar-home-set');
      record('2_propfind_home', p2, { found: Boolean(homeHref) });
      if (!p2.ok || !homeHref) {
        return Response.json({ ok: false, failedAt: '2_propfind_home', steps }, { status: 200 });
      }
      const homeUrl = resolveUrl(p2.url, homeHref.endsWith('/') ? homeHref : `${homeHref}/`);

      // 3. Create temporary calendar: test MKCALENDAR first (workerd may reject
      // it as non-standard HTTP method), falling back to RFC 5689 Extended MKCOL.
      calendarUrl = resolveUrl(homeUrl, `${probeSlug}/`);
      let createMethod = 'MKCALENDAR';
      let p3;
      try {
        p3 = await dav(calendarUrl, {
          method: 'MKCALENDAR',
          auth,
          headers: XML_HEADERS,
          body:
            '<?xml version="1.0" encoding="utf-8"?>' +
            '<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
            '<d:set><d:prop>' +
            '<d:displayname>Hour · prueba fase 0</d:displayname>' +
            '<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>' +
            '</d:prop></d:set></c:mkcalendar>',
        });
        record('3a_mkcalendar', p3);
      } catch (err) {
        steps.push({
          step: '3a_mkcalendar',
          status: 0,
          ok: false,
          ms: 0,
          error: err instanceof Error ? err.message : String(err),
        });
        createMethod = 'MKCOL';
        p3 = await dav(calendarUrl, {
          method: 'MKCOL',
          auth,
          headers: XML_HEADERS,
          body:
            '<?xml version="1.0" encoding="utf-8"?>' +
            '<d:mkcol xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
            '<d:set><d:prop>' +
            '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>' +
            '<d:displayname>Hour · prueba fase 0</d:displayname>' +
            '<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>' +
            '</d:prop></d:set></d:mkcol>',
        });
        record('3b_extended_mkcol', p3);
      }
      if (!p3.ok) {
        calendarUrl = null;
        return Response.json({ ok: false, failedAt: createMethod === 'MKCOL' ? '3b_extended_mkcol' : '3a_mkcalendar', steps }, { status: 200 });
      }

      // 4. PUT event with TZID + VALARM + SEQUENCE:0
      eventUrl = resolveUrl(calendarUrl, `${uid}.ics`);
      const p4 = await dav(eventUrl, {
        method: 'PUT',
        auth,
        headers: { 'content-type': 'text/calendar; charset=utf-8', 'if-none-match': '*' },
        body: buildProbeIcs(uid, 0),
      });
      record('4_put_event', p4, { hasEtag: Boolean(p4.etag) });
      if (!p4.ok) {
        eventUrl = null;
        return Response.json({ ok: false, failedAt: '4_put_event', steps }, { status: 200 });
      }

      // 5. REPORT sync-collection (initial)
      const p5 = await dav(calendarUrl, {
        method: 'REPORT',
        auth,
        headers: { ...XML_HEADERS, depth: '1' },
        body:
          '<?xml version="1.0" encoding="utf-8"?>' +
          '<d:sync-collection xmlns:d="DAV:">' +
          '<d:sync-token/>' +
          '<d:sync-level>1</d:sync-level>' +
          '<d:prop><d:getetag/></d:prop>' +
          '</d:sync-collection>',
      });
      const syncToken1 = extractTextTag(p5.text, 'sync-token');
      const hrefs1 = extractAllHrefs(p5.text);
      record('5_report_sync_initial', p5, {
        syncTokenPresent: Boolean(syncToken1),
        itemCount: hrefs1.length,
      });

      // 6. PUT update (SEQUENCE:1) + incremental REPORT sync-collection (or ETag PROPFIND fallback check)
      const p6Put = await dav(eventUrl, {
        method: 'PUT',
        auth,
        headers: {
          'content-type': 'text/calendar; charset=utf-8',
          ...(p4.etag ? { 'if-match': p4.etag } : {}),
        },
        body: buildProbeIcs(uid, 1),
      });
      record('6a_put_update', p6Put, { etagChanged: Boolean(p6Put.etag && p6Put.etag !== p4.etag) });

      let deltaSupported = false;
      if (syncToken1) {
        const p6Report = await dav(calendarUrl, {
          method: 'REPORT',
          auth,
          headers: { ...XML_HEADERS, depth: '1' },
          body:
            '<?xml version="1.0" encoding="utf-8"?>' +
            '<d:sync-collection xmlns:d="DAV:">' +
            `<d:sync-token>${syncToken1}</d:sync-token>` +
            '<d:sync-level>1</d:sync-level>' +
            '<d:prop><d:getetag/></d:prop>' +
            '</d:sync-collection>',
        });
        const syncToken2 = extractTextTag(p6Report.text, 'sync-token');
        const hrefs2 = extractAllHrefs(p6Report.text);
        deltaSupported = p6Report.ok && Boolean(syncToken2) && hrefs2.some((h) => h.includes(uid));
        record('6b_report_sync_delta', p6Report, {
          syncTokenAdvanced: Boolean(syncToken2 && syncToken2 !== syncToken1),
          deltaMatchedEvent: hrefs2.some((h) => h.includes(uid)),
        });
      }

      return Response.json({
        ok: steps.filter((s) => s.step !== '3a_mkcalendar' || createMethod === 'MKCALENDAR').every((s) => s.ok),
        summary: {
          mkcalendarAcceptedByWorkerd: createMethod === 'MKCALENDAR',
          calendarCreateMethodUsed: createMethod,
          workerdVerbsAccepted: ['PROPFIND', createMethod, 'PUT', 'REPORT', 'DELETE'],
          syncCollectionSupported: Boolean(syncToken1 && deltaSupported),
          fallbackNeeded: !(syncToken1 && deltaSupported),
        },
        steps,
      });
    } catch (err) {
      return Response.json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        steps,
      });
    } finally {
      if (eventUrl) {
        const delEvent = await dav(eventUrl, { method: 'DELETE', auth }).catch(() => null);
        if (delEvent) record('7a_cleanup_event', delEvent);
      }
      if (calendarUrl) {
        const delCal = await dav(calendarUrl, { method: 'DELETE', auth }).catch(() => null);
        if (delCal) record('7b_cleanup_calendar', delCal);
      }
    }
  },
};
