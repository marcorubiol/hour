/**
 * Una lista del público (ADR-173, fase 3; plan § 6.1).
 *
 * GET → AudienceDetail: la lista, los textos vigentes, las personas (sin
 *     token ni IP: los grants por columnas), las importaciones, la política
 *     del espacio y qué puede hacer quien llama.
 * PATCH { action: 'details' | 'texts' | 'status' | 'key', … } → una RPC por
 *     acción (`update_audience`, `set_audience_consent_text`,
 *     `set_audience_status`, `regenerate_audience_form_key`).
 */

import type { RequestHandler } from './$types';
import { pgGet, pgPostRpc } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';
import { mailoutRoute, pgMessage, readBody } from '$lib/server/mailout/route';
import { defaultProviderKind } from '$lib/server/mailout';
import { audienceAccess, audienceSimulated } from '$lib/server/audience';
import {
  AUDIENCE_SELECT,
  AudienceUpdateSchema,
  IMPORT_SELECT,
  SUBSCRIPTION_SELECT,
  type AudienceDetail,
  type AudienceItem,
  type ConsentTextRow,
  type ImportRow,
  type SubscriptionRow,
} from '$lib/audience';

/** Por qué no se abre, para la pantalla. */
const STATUS_REFUSALS: [RegExp, string][] = [
  [/privacy/, 'needs_privacy'],
  [/consent text/, 'needs_text'],
  [/SES/, 'needs_ses'],
];

export const GET: RequestHandler = (event) =>
  mailoutRoute(event, 'GET /api/audience/[id]', async ({ env, jwt, id }) => {
    const lists = await pgGet<AudienceItem>(env, 'audience', jwt, { search: { select: AUDIENCE_SELECT, id: `eq.${id}` } });
    const audience = lists.data[0];
    if (!audience) return jsonNoStore({ error: 'not_found' }, 404);
    const [ws, texts, subs, imports, access, simulated] = await Promise.all([
      pgGet<AudienceDetail['workspace']>(env, 'workspace', jwt, {
        search: { select: 'id,slug,name,privacy_url', id: `eq.${audience.workspace_id}` },
      }),
      audience.current_text_version
        ? pgGet<ConsentTextRow>(env, 'audience_consent_text', jwt, {
            search: {
              select: 'id,version,language,consent_text,info_text,privacy_url,created_at',
              audience_id: `eq.${id}`,
              version: `eq.${audience.current_text_version}`,
            },
          })
        : Promise.resolve({ data: [] as ConsentTextRow[] }),
      pgGet<SubscriptionRow>(env, 'audience_subscription', jwt, {
        search: { select: SUBSCRIPTION_SELECT, audience_id: `eq.${id}`, order: 'created_at.desc', limit: '5000' },
      }),
      pgGet<ImportRow>(env, 'audience_import', jwt, {
        search: { select: IMPORT_SELECT, audience_id: `eq.${id}`, order: 'declared_at.desc' },
      }),
      audienceAccess(env, jwt, [audience.workspace_id]),
      audienceSimulated(env, jwt, audience.workspace_id, defaultProviderKind(env)),
    ]);
    if (!ws.data[0]) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({
      audience,
      workspace: ws.data[0],
      access: access[audience.workspace_id] ?? { read: true, edit: false, admin: false },
      texts: texts.data,
      subscriptions: subs.data,
      imports: imports.data,
      simulated,
    } satisfies AudienceDetail);
  });

export const PATCH: RequestHandler = (event) =>
  mailoutRoute(event, 'PATCH /api/audience/[id]', async ({ env, jwt, id }) => {
    const body = await readBody(event.request, AudienceUpdateSchema);
    if (body instanceof Response) return body;
    switch (body.action) {
      case 'details':
        await pgPostRpc(env, 'update_audience', jwt, {
          p_id: id,
          p_name: body.name,
          p_description: body.description || null,
          p_languages: body.languages,
          p_default_language: body.languages.includes(body.default_language) ? body.default_language : body.languages[0],
        });
        break;
      case 'texts':
        await pgPostRpc(env, 'set_audience_consent_text', jwt, { p_audience_id: id, p_texts: body.texts });
        break;
      case 'status':
        try {
          await pgPostRpc(env, 'set_audience_status', jwt, { p_id: id, p_status: body.status });
        } catch (err) {
          const refusal = STATUS_REFUSALS.find(([re]) => re.test(pgMessage(err)));
          if (refusal) return jsonNoStore({ error: refusal[1] }, 409);
          throw err;
        }
        break;
      case 'key':
        await pgPostRpc(env, 'regenerate_audience_form_key', jwt, { p_id: id });
        break;
    }
    return jsonNoStore({ ok: true });
  });
