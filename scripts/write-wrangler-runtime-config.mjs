import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [outputArg] = process.argv.slice(2);
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const publishableKey = process.env.PUBLIC_SUPABASE_ANON_KEY;

if (!outputArg || !supabaseUrl || !publishableKey) {
  throw new Error(
    'Usage: PUBLIC_SUPABASE_URL=... PUBLIC_SUPABASE_ANON_KEY=... node scripts/write-wrangler-runtime-config.mjs <output>',
  );
}

const inputPath = resolve('apps/web/wrangler.jsonc');
const outputPath = resolve(outputArg);
let config = await readFile(inputPath, 'utf8');

function replaceStringVar(name, value) {
  const pattern = new RegExp(`("${name}"\\s*:\\s*)"[^"]*"`);
  if (!pattern.test(config)) throw new Error(`Missing ${name} in ${inputPath}`);
  config = config.replace(pattern, `$1${JSON.stringify(value)}`);
}

replaceStringVar('PUBLIC_SUPABASE_URL', supabaseUrl);
replaceStringVar('PUBLIC_SUPABASE_ANON_KEY', publishableKey);
await writeFile(outputPath, config, { mode: 0o600 });
console.log(`Runtime Wrangler config written to ${outputPath}`);
