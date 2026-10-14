import { describe, expect, test } from 'vitest';
import * as v from 'valibot';
import {
  AudienceQuerySchema,
  MessageCreateSchema,
  audienceLine,
  boardLayout,
  boloPlace,
  conversationThread,
  facetName,
  firstUnreadId,
  isUnread,
  messageWhen,
  messagesByThread,
  performanceOptions,
  performanceTag,
  teamTimeline,
  threadKey,
  type BoardPerformance,
  type ThreadMessage,
} from './threads';

const ME = 'me';
const OTHER = 'other';
const UUID = '01a13919-4bce-7228-bca6-7e29d9d81852';

function msg(id: string, at: string, author: string | null = OTHER, thread = 't1'): ThreadMessage {
  return { id, thread_id: thread, author_id: author, performance_id: null, body: id, created_at: at, edited_at: null };
}

describe('facetName', () => {
  test('General no es una faceta: sin clave, su propia palabra', () => {
    expect(facetName({ facet_key: null, label: null }, 'es')).toBe('General');
  });
  test('una estándar sin renombrar sale de su clave i18n', () => {
    expect(facetName({ facet_key: 'tecnica', label: null, labels: {} }, 'es')).toBe('Técnica');
    expect(facetName({ facet_key: 'diners', label: null, labels: {} }, 'es')).toBe('Dinero');
  });
  test('el nombre del espacio en su idioma gana; sin idioma, su nombre a secas', () => {
    const f = { facet_key: 'tecnica', label: 'Tècnica i so', labels: { en: 'Tech & sound' } };
    expect(facetName(f, 'en')).toBe('Tech & sound');
    expect(facetName(f, 'es')).toBe('Tècnica i so');
  });
});

describe('audienceLine', () => {
  test('por tipo de hilo: bolo, faceta, conversación', () => {
    expect(audienceLine({ count: 5, reason: { kind: 'container', level: 'bolo' } }, 'es')).toBe(
      'Lo ven 5, por estar en el bolo',
    );
    expect(
      audienceLine(
        { count: 3, reason: { kind: 'facet', facet_key: 'tecnica', label: null, labels: {} } },
        'es',
      ),
    ).toBe('Lo ven 3, por permiso de Técnica');
    expect(audienceLine({ count: 2, reason: { kind: 'conversation' } }, 'es')).toBe(
      'Lo ven 2, quien ve esta conversación',
    );
  });
  test('la razón de una faceta dice el nombre que le dio el espacio', () => {
    expect(
      audienceLine(
        { count: 4, reason: { kind: 'facet', facet_key: 'comidas', label: 'Càtering', labels: {} } },
        'es',
      ),
    ).toBe('Lo ven 4, por permiso de Càtering');
  });
  test('uno solo eres tú: quien ve la línea ya lee el hilo', () => {
    expect(audienceLine({ count: 1, reason: { kind: 'container', level: 'bolo' } }, 'es')).toBe(
      'Solo lo ves tú, por estar en el bolo',
    );
  });
});

describe('performanceTag', () => {
  test('día de la semana y número, y la hora con el reloj del Planner en la zona de la sala', () => {
    // 2027-03-13 es sábado; 10:00Z son las 11h en Madrid (CET).
    const p = { performed_at: '2027-03-13', start_at: '2027-03-13T10:00:00Z' };
    expect(performanceTag(p, 'es', 'Europe/Madrid')).toBe('sáb 13 · 11h');
    expect(performanceTag(p, 'en', 'Europe/London')).toBe('Sat 13 · 10h');
  });
  test('sin hora de inicio, solo el día', () => {
    expect(performanceTag({ performed_at: '2027-03-12', start_at: null }, 'es', 'Europe/Madrid')).toBe('vie 12');
  });
});

describe('messageWhen', () => {
  const now = new Date('2027-03-13T18:00:00Z');
  test('hoy, solo la hora', () => {
    expect(messageWhen('2027-03-13T10:32:00Z', 'es', 'Europe/Madrid', now)).toBe('11h32');
  });
  test('otro día, día y mes delante', () => {
    expect(messageWhen('2027-03-12T10:00:00Z', 'es', 'Europe/Madrid', now)).toBe('12 mar · 11h');
  });
  test('el día es el de quien lee, no el de UTC', () => {
    // 23:30Z del 12 son las 00:30 del 13 en Madrid: hoy.
    expect(messageWhen('2027-03-12T23:30:00Z', 'es', 'Europe/Madrid', now)).toBe('00h30');
  });
});

describe('messagesByThread', () => {
  test('agrupa por hilo y ordena del más antiguo al más nuevo', () => {
    const list = [
      msg('c', '2027-03-13T12:00:00Z'),
      msg('x', '2027-03-13T09:00:00Z', OTHER, 't2'),
      msg('a', '2027-03-13T10:00:00Z'),
      msg('b', '2027-03-13T11:00:00Z'),
    ];
    const by = messagesByThread(list);
    expect(by.get('t1')?.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(by.get('t2')?.map((m) => m.id)).toEqual(['x']);
    expect(by.get('t3')).toBeUndefined();
  });
});

describe('no leídos', () => {
  test('lo propio nunca es nuevo', () => {
    expect(isUnread(msg('a', '2027-03-13T10:00:00Z', ME), ME, null)).toBe(false);
  });
  test('sin lectura, todo lo ajeno es nuevo; con lectura, lo posterior', () => {
    expect(isUnread(msg('a', '2027-03-13T10:00:00Z'), ME, null)).toBe(true);
    expect(isUnread(msg('a', '2027-03-13T10:00:00Z'), ME, '2027-03-13T10:00:00Z')).toBe(false);
    expect(isUnread(msg('a', '2027-03-13T10:00:01Z'), ME, '2027-03-13T10:00:00Z')).toBe(true);
  });
  test('la raya va sobre el primer mensaje ajeno posterior a la lectura', () => {
    const list = [
      msg('a', '2027-03-13T09:00:00Z'),
      msg('b', '2027-03-13T11:00:00Z', ME),
      msg('c', '2027-03-13T12:00:00Z'),
    ];
    expect(firstUnreadId(list, ME, '2027-03-13T10:00:00Z')).toBe('c');
    expect(firstUnreadId(list, ME, '2027-03-13T13:00:00Z')).toBeNull();
    expect(firstUnreadId(list, ME, null)).toBe('a');
  });
});

describe('performanceOptions', () => {
  const perfs: BoardPerformance[] = [
    { id: 'p1', slug: 'a', performed_at: '2027-03-12', start_at: null, venue_name: null, city: null },
    { id: 'p2', slug: 'b', performed_at: '2027-03-13', start_at: '2027-03-13T10:00:00Z', venue_name: null, city: null },
  ];
  test('con una función no se pregunta de cuál habla', () => {
    expect(performanceOptions(perfs.slice(0, 1), 'es', 'Europe/Madrid')).toEqual([]);
  });
  test('con varias, primero «todo el bolo» (vacío) y después cada función', () => {
    expect(performanceOptions(perfs, 'es', 'Europe/Madrid')).toEqual([
      { value: '', label: 'Todo el bolo' },
      { value: 'p1', label: 'vie 12' },
      { value: 'p2', label: 'sáb 13 · 11h' },
    ]);
  });
});

describe('boardLayout', () => {
  const th = (facet_id: string | null, message_count: number) => ({ facet_id, message_count });
  const general = th(null, 2);
  const tecnica = th('tecnica', 3);
  const logistica = th('logistica', 1);
  const materials = th('materials', 0);
  const diners = th('diners', 0);
  const all = [general, materials, tecnica, logistica, diners];

  test('nuevos arriba, luego con mensajes, y los vacíos plegados al final, cada grupo en su orden', () => {
    const { open, folded } = boardLayout(all, (t) => t === logistica);
    expect(open).toEqual([logistica, general, tecnica]);
    expect(folded).toEqual([materials, diners]);
  });
  test('General sin mensajes también se pliega', () => {
    const emptyGeneral = th(null, 0);
    const { open, folded } = boardLayout([emptyGeneral, tecnica], () => false);
    expect(open).toEqual([tecnica]);
    expect(folded).toEqual([emptyGeneral]);
  });
  test('un vacío que se abrió para escribir se despliega, detrás de los que tienen mensajes', () => {
    const { open, folded } = boardLayout(all, () => false, new Set(['diners']));
    expect(open).toEqual([general, tecnica, logistica, diners]);
    expect(folded).toEqual([materials]);
  });
  test('«nuevo» sin mensajes no existe: un vacío nunca sube', () => {
    const { open } = boardLayout([materials], () => true);
    expect(open).toEqual([]);
  });
});

describe('forma', () => {
  test('la clave de un hilo es su faceta, y General la cadena vacía', () => {
    expect(threadKey({ facet_id: null })).toBe('');
    expect(threadKey({ facet_id: 'f' })).toBe('f');
  });
  test('el bolo se nombra por su sala y su ciudad, nunca por un título que no tiene', () => {
    expect(boloPlace({ venue_name: 'Cuarta Pared', city: 'Madrid' })).toBe('Cuarta Pared · Madrid');
    expect(boloPlace({ venue_name: null, city: 'Madrid' })).toBe('Madrid');
    expect(boloPlace({ venue_name: null, city: null })).toBe('');
  });
});

describe('el hilo del equipo de una conversación', () => {
  test('sin hilo todavía: General de la conversación, vacío y sin id', () => {
    expect(conversationThread(null, [], ME, null)).toEqual({
      thread_id: null,
      facet_id: null,
      facet_key: null,
      label: null,
      labels: {},
      message_count: 0,
      unread_count: 0,
      last_message_at: null,
    });
  });
  test('cuenta como bolo_board: lo ajeno posterior a la lectura, nunca lo propio', () => {
    const list = [
      msg('a', '2026-10-14T08:00:00Z'),
      msg('b', '2026-10-14T09:00:00Z', ME),
      msg('c', '2026-10-14T10:00:00Z'),
    ];
    const th = conversationThread({ id: 't1', last_message_at: '2026-10-14T10:00:00Z' }, list, ME, '2026-10-14T08:30:00Z');
    expect(th).toMatchObject({ thread_id: 't1', facet_id: null, message_count: 3, unread_count: 1 });
    expect(conversationThread({ id: 't1', last_message_at: null }, list, ME, null).unread_count).toBe(2);
  });
});

describe('la vista «hilo»: registro y equipo en una línea', () => {
  const ev = (id: string, at: string) => ({ id, occurred_at: at });
  test('del más antiguo al más nuevo, cada cosa con lo que es', () => {
    const line = teamTimeline(
      [ev('e2', '2026-10-14T12:00:00Z'), ev('e1', '2026-10-14T08:00:00Z')],
      [msg('m1', '2026-10-14T09:00:00Z'), msg('m2', '2026-10-14T13:00:00Z')],
    );
    expect(line.map((x) => (x.kind === 'event' ? `e:${x.event.id}` : `m:${x.message.id}`))).toEqual([
      'e:e1',
      'm:m1',
      'e:e2',
      'm:m2',
    ]);
  });
  test('a la misma hora, lo de fuera primero: el equipo comenta lo que llegó', () => {
    const at = '2026-10-14T10:00:00Z';
    const line = teamTimeline([ev('e1', at)], [msg('m1', at)]);
    expect(line.map((x) => x.kind)).toEqual(['event', 'message']);
  });
  test('sin equipo, el registro tal cual; sin registro, el equipo tal cual', () => {
    expect(teamTimeline([ev('e1', '2026-10-14T10:00:00Z')], []).map((x) => x.kind)).toEqual(['event']);
    expect(teamTimeline([], [msg('m1', '2026-10-14T10:00:00Z')]).map((x) => x.kind)).toEqual(['message']);
  });
});

describe('esquemas', () => {
  test('un mensaje recorta el cuerpo y no cabe vacío ni de más de 10.000', () => {
    const ok = v.safeParse(MessageCreateSchema, { anchor_kind: 'bolo', anchor_id: UUID, body: '  hola  ' });
    expect(ok.success && ok.output.body).toBe('hola');
    expect(v.safeParse(MessageCreateSchema, { anchor_kind: 'bolo', anchor_id: UUID, body: '   ' }).success).toBe(false);
    expect(
      v.safeParse(MessageCreateSchema, { anchor_kind: 'bolo', anchor_id: UUID, body: 'x'.repeat(10_001) }).success,
    ).toBe(false);
  });
  test('no hay campo de autor ni anclas fuera de bolo y conversación', () => {
    expect(v.safeParse(MessageCreateSchema, { anchor_kind: 'project', anchor_id: UUID, body: 'x' }).success).toBe(false);
    const withAuthor = v.safeParse(MessageCreateSchema, { anchor_kind: 'bolo', anchor_id: UUID, body: 'x', author_id: UUID });
    expect(withAuthor.success && 'author_id' in withAuthor.output).toBe(false);
  });
  test('la audiencia de General llega con facet_id vacío y sale null', () => {
    const r = v.safeParse(AudienceQuerySchema, { anchor_kind: 'bolo', anchor_id: UUID, facet_id: '' });
    expect(r.success && r.output.facet_id).toBeNull();
  });
});
