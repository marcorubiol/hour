import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envReady, login, pgGet, pgRpc, requireEnv } from './_helpers';

/**
 * ADR-087 — un trato tiene vida: nace donde está y se mueve.
 *
 * Hasta el 2026-08-29 no la tenía. `create_bolo` ponía `confirmed` por defecto
 * y la API ni siquiera pasaba el estado, así que **todo bolo creado desde Hour
 * nacía cerrado**; y como `bolo` no tiene policy de UPDATE y ninguna RPC lo
 * tocaba, el estado **no se podía cambiar nunca**. El embudo existía en el enum
 * y en ningún otro sitio.
 *
 * Lo que fija este fichero es el borde, que es lo único que un enum no dice:
 * `invoiced` y `paid` NO son de un humano. Money v3 deriva lo cobrado de los
 * pagos contra el caché, así que escribirlos a mano crearía un segundo sitio
 * donde vive la verdad del dinero.
 *
 * Va rojo contra un origen sin `20260829140000`. Autolimpiante.
 */
const RUN = `${Date.now()}`;

describe.skipIf(!envReady())('bolo status lifecycle (ADR-087)', () => {
  let jwt: string;
  let projectId: string;
  const made: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const p = await pgGet<{ id: string }>('project?select=id&slug=eq.zzz-e2e-collab', jwt);
    expect(p.status).toBe(200);
    projectId = p.rows[0]!.id;
  });

  afterAll(async () => {
    for (const id of made) await pgRpc('delete_bolo', jwt, { p_bolo_id: id });
  });

  const open = (status: string) =>
    pgRpc<{ id: string; status: string }>('create_bolo', jwt, {
      p_project_id: projectId,
      p_venue_name: `RLS status ${status} ${RUN}`,
      p_status: status,
    });

  it('OPENS WHERE THE NEGOTIATION IS, not always closed', async () => {
    for (const s of ['proposed', 'hold', 'hold_1', 'hold_2', 'hold_3', 'confirmed']) {
      const r = await open(s);
      expect(r.status, `${s} must be a legal birth: ${r.error}`).toBe(200);
      expect(r.data!.status, 'and it must be the one asked for').toBe(s);
      made.push(r.data!.id);
    }
  });

  it('does not open dead or finished', async () => {
    for (const s of ['cancelled', 'done']) {
      expect((await open(s)).status, `${s} is not a birth`).toBe(400);
    }
  });

  it('NEVER opens as invoiced or paid — those are derived from payments', async () => {
    for (const s of ['invoiced', 'paid']) {
      expect((await open(s)).status, s).toBe(400);
    }
  });

  it('MOVES through the funnel, and the move sticks', async () => {
    const r = await open('proposed');
    expect(r.status).toBe(200);
    const id = r.data!.id;
    made.push(id);
    for (const s of ['hold_1', 'confirmed', 'done', 'cancelled', 'proposed']) {
      const m = await pgRpc<{ id: string; status: string }>('update_bolo_status', jwt, {
        p_bolo_id: id,
        p_status: s,
      });
      expect(m.status, `${s}: ${m.error}`).toBe(200);
      expect(m.data!.status).toBe(s);
    }
  });

  it('refuses to be moved to invoiced or paid', async () => {
    const r = await open('confirmed');
    expect(r.status).toBe(200);
    made.push(r.data!.id);
    for (const s of ['invoiced', 'paid']) {
      const m = await pgRpc('update_bolo_status', jwt, { p_bolo_id: r.data!.id, p_status: s });
      expect(m.status, `${s} must not be settable by hand`).toBe(400);
    }
  });

  it('a bolo that is not yours is the same answer as one that is not there', async () => {
    const m = await pgRpc('update_bolo_status', jwt, {
      p_bolo_id: '00000000-0000-0000-0000-000000000000',
      p_status: 'confirmed',
    });
    expect(m.status, 'no existence oracle').toBe(403);
  });
});
