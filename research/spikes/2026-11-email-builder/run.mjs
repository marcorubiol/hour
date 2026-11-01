// Carga las dos páginas en Chromium, hace captura, exporta y compila a HTML.
// Uso: npm i --ignore-scripts && bash build.sh && (cd dist && python3 -m http.server 8765 --bind 127.0.0.1) & node run.mjs
// PLAYWRIGHT: ruta a un paquete playwright instalado (el del checkout principal de Hour sirve).
// PW_CHROMIUM: ejecutable de Chromium si Playwright pide otra revisión.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = (await import(process.env.PLAYWRIGHT ?? 'playwright')).default;
const mjml2html = require('mjml');
const dir = new URL('.', import.meta.url).pathname;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

for (const n of ['grapes', 'tpl']) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  const hosts = new Set();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  await page.goto(`http://127.0.0.1:8765/${n}/index.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}shot-${n}.png` });
  const out = await page.evaluate(() => window.__export());
  let html = out.html;
  if (n === 'tpl') {
    // Templatical exporta MJML; la compilación a HTML va aparte (en Hour, en el servidor).
    const r = await mjml2html(out.mjml, { validationLevel: 'soft' });
    html = r.html;
    out.errors = r.errors;
  }
  writeFileSync(`${dir}out-${n}.html`, html ?? '');
  writeFileSync(`${dir}out-${n}.json`, out.json ?? '');
  console.log(n, {
    pageErrors: errors,
    htmlBytes: html?.length,
    jsonBytes: out.json?.length,
    mjmlErrors: out.errors?.length,
    msoConditionals: /\[if mso/.test(html ?? ''),
    hosts: [...hosts],
  });
  await page.close();
}
await browser.close();
