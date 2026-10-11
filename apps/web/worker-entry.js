// Entrada del despliegue (`wrangler deploy worker-entry.js`, ver package.json):
// el Worker que genera @sveltejs/adapter-cloudflare más el `scheduled` del cron
// de correo (src/worker-cron.ts). `wrangler dev` y `vite dev` siguen usando la
// salida del adaptador, sin cron.
import app from './.svelte-kit/cloudflare/_worker.js';
import { scheduled } from './src/worker-cron.ts';

export default { ...app, scheduled };
