/**
 * RLS suite — env loader.
 *
 * Vitest doesn't auto-populate process.env from .env files for Node-mode
 * projects (PUBLIC_* prefix isn't recognised the way Vite does in browser
 * mode). This setup file fills the gap with a minimal dotenv parser so
 * tests can read `process.env.PUBLIC_SUPABASE_URL` etc. Existing env vars
 * (e.g. set via shell `source .env.test`) take precedence.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile(filename: string): void {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.test');
