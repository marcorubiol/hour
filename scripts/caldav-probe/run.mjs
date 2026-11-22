#!/usr/bin/env node
/**
 * Runner local para la prueba técnica de Fase 0 (CalDAV desde Cloudflare Workers).
 *
 * Modos:
 *   node scripts/caldav-probe/run.mjs --mock
 *     Levanta un servidor CalDAV mock local + `wrangler dev` (workerd real) y
 *     verifica que el `fetch` de Workers acepta PROPFIND, MKCALENDAR, PUT,
 *     REPORT y DELETE.
 *
 *   node scripts/caldav-probe/run.mjs
 *     Ejecuta la prueba real contra `https://caldav.icloud.com/` usando
 *     ICLOUD_APPLE_ID e ICLOUD_APP_PASSWORD desde:
 *       1) variables de entorno,
 *       2) `.env.icloud` en la raíz del repo (gitignored), o
 *       3) Keychain de macOS (`security find-generic-password -s hour-caldav-probe`).
 *     La contraseña nunca se imprime ni se escribe en git.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const WORKER_PORT = 18791;
const MOCK_PORT = 18792;
const isMock = process.argv.includes('--mock');

function loadEnvFile(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  for (const raw of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function loadCredentials() {
  if (isMock) return { appleId: 'probe@example.test', appPassword: 'mock-password' };
  const fromFile = loadEnvFile(path.join(REPO_ROOT, '.env.icloud'));
  const appleId = process.env.ICLOUD_APPLE_ID || fromFile.ICLOUD_APPLE_ID || '';
  let appPassword = process.env.ICLOUD_APP_PASSWORD || fromFile.ICLOUD_APP_PASSWORD || '';
  if (!appPassword && process.platform === 'darwin' && appleId) {
    try {
      appPassword = execFileSync(
        'security',
        ['find-generic-password', '-s', 'hour-caldav-probe', '-a', appleId, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    } catch {
      // No entry in Keychain
    }
  }
  if (!appleId || !appPassword) {
    console.error(
      'Faltan credenciales de iCloud. Pon ICLOUD_APPLE_ID e ICLOUD_APP_PASSWORD en .env.icloud (gitignored) o en Keychain (servicio "hour-caldav-probe"). Ver scripts/caldav-probe/README.md.',
    );
    process.exit(1);
  }
  return { appleId, appPassword };
}

function startMockCaldavServer() {
  const calendars = new Map();
  let tokenSeq = 0;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const u = new URL(req.url || '/', `http://127.0.0.1:${MOCK_PORT}`);
      const p = u.pathname;

      if (req.method === 'PROPFIND' && p === '/') {
        res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' });
        res.end(
          '<?xml version="1.0" encoding="utf-8"?>' +
            '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop>' +
            '<d:current-user-principal><d:href>/12345/principal/</d:href></d:current-user-principal>' +
            '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',
        );
        return;
      }

      if (req.method === 'PROPFIND' && p === '/12345/principal/') {
        res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' });
        res.end(
          '<?xml version="1.0" encoding="utf-8"?>' +
            '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response>' +
            '<d:href>/12345/principal/</d:href><d:propstat><d:prop>' +
            '<c:calendar-home-set><d:href>/12345/calendars/</d:href></c:calendar-home-set>' +
            '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',
        );
        return;
      }

      if ((req.method === 'MKCALENDAR' || req.method === 'MKCOL') && p.startsWith('/12345/calendars/')) {
        calendars.set(p, new Map());
        res.writeHead(201);
        res.end();
        return;
      }

      if (req.method === 'PUT' && p.endsWith('.ics')) {
        const calPath = p.slice(0, p.lastIndexOf('/') + 1);
        const cal = calendars.get(calPath);
        if (!cal) {
          res.writeHead(404);
          res.end();
          return;
        }
        tokenSeq += 1;
        const etag = `"etag-${tokenSeq}"`;
        cal.set(p, { body, etag, seq: tokenSeq });
        res.writeHead(201, { etag });
        res.end();
        return;
      }

      if (req.method === 'REPORT' && calendars.has(p)) {
        const cal = calendars.get(p);
        const requested = /<d:sync-token>([^<]+)<\/d:sync-token>/i.exec(body)?.[1] ?? null;
        const since = requested ? Number(requested.replace('sync-', '')) : 0;
        const responses = [...cal.entries()]
          .filter(([, item]) => item.seq > since)
          .map(
            ([href, item]) =>
              `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>${item.etag}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
          )
          .join('');
        res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' });
        res.end(
          `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses}<d:sync-token>sync-${tokenSeq}</d:sync-token></d:multistatus>`,
        );
        return;
      }

      if (req.method === 'DELETE') {
        if (p.endsWith('.ics')) {
          const calPath = p.slice(0, p.lastIndexOf('/') + 1);
          calendars.get(calPath)?.delete(p);
        } else {
          calendars.delete(p);
        }
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(405);
      res.end(`Unhandled ${req.method} ${p}`);
    });
  });

  return new Promise((resolve) => {
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function waitForHealth(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // booting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('wrangler dev did not become ready in time');
}

async function main() {
  const creds = loadCredentials();
  const mockServer = isMock ? await startMockCaldavServer() : null;
  const wranglerBin = path.join(REPO_ROOT, 'apps/web/node_modules/.bin/wrangler');

  const wrangler = spawn(
    wranglerBin,
    ['dev', '--config', path.join(__dirname, 'wrangler.jsonc'), '--port', String(WORKER_PORT), '--ip', '127.0.0.1'],
    {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    },
  );

  let stderrBuf = '';
  wrangler.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString('utf8');
  });

  try {
    await waitForHealth(`http://127.0.0.1:${WORKER_PORT}/health`);
    const baseUrl = isMock ? `http://127.0.0.1:${MOCK_PORT}/` : 'https://caldav.icloud.com/';
    const res = await fetch(`http://127.0.0.1:${WORKER_PORT}/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl, ...creds }),
    });
    const raw = await res.text();
    let report;
    try {
      report = JSON.parse(raw);
    } catch {
      console.error(`Non-JSON response (HTTP ${res.status}):\n${raw.slice(0, 1500)}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ mode: isMock ? 'mock' : 'icloud', ...report }, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (err) {
    console.error('Probe failed:', err instanceof Error ? err.message : String(err));
    if (stderrBuf) console.error(stderrBuf.slice(-1500));
    process.exitCode = 1;
  } finally {
    wrangler.kill('SIGTERM');
    if (mockServer) mockServer.close();
  }
}

await main();
