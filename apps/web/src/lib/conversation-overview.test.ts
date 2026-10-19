import { describe, expect, it } from 'vitest';
import {
  BLOCK_ROWS,
  COLD_IDLE_DAYS,
  COLD_REPLY_DAYS,
  HOT_DAYS,
  NO_LINE,
  applyListFilter,
  buildOverview,
  coolingOf,
  countByRelation,
  currentSeason,
  daysSince,
  dueReason,
  followUpDue,
  inSeason,
  isHot,
  isUndated,
  mailoutFigures,
  parseListFilter,
  seasonOf,
  seasonByLine,
  seasonRows,
  turnOf,
  type OverviewInput,
} from './conversation-overview';

// Viernes 16 de octubre de 2026, 10:00, en la hora LOCAL: los días de
// calendario salen iguales en cualquier zona de quien corre los tests.
const NOW = new Date(2026, 9, 16, 10, 0, 0);

/** Un instante de hace `days` días, a la hora local `hour`. */
function ago(days: number, hour = 9): string {
  return new Date(2026, 9, 16 - days, hour, 0, 0).toISOString();
}
/** Un día (YYYY-MM-DD) a `offset` días de hoy. */
function day(offset: number): string {
  const d = new Date(2026, 9, 16 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function row(id: string, o: Partial<OverviewInput> = {}): OverviewInput {
  return {
    id,
    workspace_id: 'w1',
    project_id: 'p1',
    line_id: null,
    not_now_at: null,
    not_now_until: null,
    last_contacted_at: null,
    first_contacted_at: null,
    contacted_undated: false,
    legacy_status: null,
    regular: false,
    next_action_at: null,
    next_action_note: null,
    title: `Sala ${id}`,
    person: null,
    last: null,
    last_in: null,
    performance_days: [],
    ...o,
  };
}

const inbound = (days: number, subject: string | null = null) => ({
  last: { direction: 'inbound' as const, occurred_at: ago(days), kind: 'email', subject },
  last_in: { occurred_at: ago(days) },
});
const outbound = (days: number, subject: string | null = null) => ({
  last: { direction: 'outbound' as const, occurred_at: ago(days), kind: 'email', subject },
});
/** «No esta vez», marcado ahora: después de cualquier evento del test. */
const notNow = { not_now_at: NOW.toISOString() };
/** Su estado viejo decía que habían contestado (ADR-138 § 8.5). */
const talked = (legacy: 'in_conversation' | 'hold' | 'confirmed' = 'in_conversation') => ({ legacy_status: legacy });

describe('daysSince', () => {
  it('cuenta días de calendario, no horas', () => {
    expect(daysSince(new Date(2026, 9, 15, 23, 59).toISOString(), NOW)).toBe(1);
    expect(daysSince(new Date(2026, 9, 16, 0, 1).toISOString(), NOW)).toBe(0);
    expect(daysSince('2026-10-09', NOW)).toBe(7);
    expect(daysSince('2026-10-20', NOW)).toBe(-4);
  });
});

describe('turnOf', () => {
  it('es nuestro si el último vino de fuera, suyo si fue nuestro', () => {
    expect(turnOf(row('a', inbound(2)), NOW)).toEqual({ side: 'ours', since: ago(2), days: 2 });
    expect(turnOf(row('b', outbound(5)), NOW)?.side).toBe('theirs');
  });
  it('una sala con un trato confirmado sigue teniendo turno: el trato es del bolo (ADR-138)', () => {
    expect(turnOf(row('a', { ...talked('confirmed'), ...inbound(50) }), NOW)?.side).toBe('ours');
  });
  it('«no pide respuesta» atiende esa respuesta, no la siguiente', () => {
    const settled = row('a', { ...inbound(3), reply_settled_at: ago(3) });
    expect(turnOf(settled, NOW)).toBeNull();
    expect(dueReason(settled, NOW)).toBeNull();
    expect(turnOf(row('b', { ...inbound(1), reply_settled_at: ago(3) }), NOW)?.side).toBe('ours');
  });
  it('sin eventos, o en «no esta vez», no hay turno', () => {
    expect(turnOf(row('a'), NOW)).toBeNull();
    expect(turnOf(row('b', { ...notNow, ...inbound(1) }), NOW)).toBeNull();
  });
  it('«no esta vez» caducado devuelve el turno', () => {
    expect(turnOf(row('a', { ...notNow, not_now_until: day(0), ...inbound(1) }), NOW)?.side).toBe('ours');
  });
});

describe('dueReason', () => {
  it('una respuesta pendiente gana a un seguimiento', () => {
    expect(dueReason(row('a', { ...inbound(1), next_action_at: day(-3) }), NOW)).toBe('reply');
  });
  it('un seguimiento de hoy o vencido te toca; uno futuro, no', () => {
    expect(followUpDue(row('a', { next_action_at: `${day(0)}T00:00:00+00:00` }), NOW)).toBe(true);
    expect(dueReason(row('b', { ...outbound(3), next_action_at: day(-2) }), NOW)).toBe('follow_up');
    expect(dueReason(row('c', { next_action_at: day(2) }), NOW)).toBeNull();
    expect(dueReason(row('d', { ...notNow, next_action_at: day(-2) }), NOW)).toBeNull();
  });
});

describe('isHot', () => {
  it('cualquier sala que nos escribió en los últimos días', () => {
    expect(isHot(row('a', inbound(HOT_DAYS)), NOW)).toBe(true);
    expect(isHot(row('b', { last_in: { occurred_at: ago(HOT_DAYS + 1) } }), NOW)).toBe(false);
    // Contestó hace más, y la actividad reciente es nuestra: sigue en conversación.
    expect(isHot(row('c', { ...outbound(1), last_in: { occurred_at: ago(HOT_DAYS + 1) } }), NOW)).toBe(true);
  });
  it('una que ha contestado, con actividad reciente, aunque la actividad sea nuestra', () => {
    expect(isHot(row('a', { ...talked('hold'), ...outbound(3) }), NOW)).toBe(true);
    expect(isHot(row('b', { ...talked(), last_contacted_at: ago(2) }), NOW)).toBe(true);
    expect(isHot(row('c', outbound(3)), NOW)).toBe(false);
  });
  it('una en «no esta vez» no está caliente', () => {
    expect(isHot(row('a', { ...inbound(1), ...notNow }), NOW)).toBe(false);
  });
});

describe('coolingOf', () => {
  it(`nuestro correo sin respuesta desde hace ${COLD_REPLY_DAYS} días`, () => {
    expect(coolingOf(row('a', outbound(COLD_REPLY_DAYS)), NOW)).toEqual({ reason: 'no_reply', days: COLD_REPLY_DAYS, group: 'round' });
    expect(coolingOf(row('b', outbound(COLD_REPLY_DAYS - 1)), NOW)).toBeNull();
  });
  it(`una conversación con respuesta parada ${COLD_IDLE_DAYS} días`, () => {
    expect(coolingOf(row('a', { ...talked(), last_contacted_at: ago(COLD_IDLE_DAYS) }), NOW)).toEqual({
      reason: 'idle',
      days: COLD_IDLE_DAYS,
      group: 'stalled',
    });
    expect(coolingOf(row('b', { ...talked('hold'), last_contacted_at: ago(COLD_IDLE_DAYS - 1) }), NOW)).toBeNull();
  });
  it('si te toca a ti no se enfría: es tuya', () => {
    expect(coolingOf(row('a', inbound(60)), NOW)).toBeNull();
  });
  it('una contactada de antes del historial cuenta su sello de contacto', () => {
    expect(coolingOf(row('a', { last_contacted_at: ago(40) }), NOW)).toEqual({ reason: 'no_reply', days: 40, group: 'round' });
  });
  it('sin ninguna fecha no se enfría ni te toca: no lo sabemos, se cuenta aparte', () => {
    const undated = row('b', { contacted_undated: true });
    expect(coolingOf(undated, NOW)).toBeNull();
    expect(dueReason(undated, NOW)).toBeNull();
    expect(isUndated(undated, NOW)).toBe(true);
    expect(isUndated(row('c', talked('hold')), NOW)).toBe(true);
    // A date, an event or a follow-up: not undated. Never contacted or «not this time»: not counted.
    expect(isUndated(row('d', { contacted_undated: true, last_contacted_at: ago(3) }), NOW)).toBe(false);
    expect(isUndated(row('e', { contacted_undated: true, ...outbound(3) }), NOW)).toBe(false);
    expect(isUndated(row('f', { contacted_undated: true, next_action_at: day(5) }), NOW)).toBe(false);
    expect(isUndated(row('g'), NOW)).toBe(false);
    expect(isUndated(row('h', { contacted_undated: true, ...notNow }), NOW)).toBe(false);
    const o = buildOverview([undated, row('c', talked('hold')), row('x', outbound(30))], NOW);
    expect(o.undated).toBe(2);
    expect(o.cold.count).toBe(1);
    expect(o.due.count).toBe(0);
    expect(applyListFilter([undated, row('x', outbound(30))], { temp: 'sin-fecha' }, NOW).map((r) => r.id)).toEqual(['b']);
  });
  it('un seguimiento vencido es tuyo y uno futuro no está olvidado: no se enfrían', () => {
    expect(coolingOf(row('a', { ...talked('hold'), next_action_at: day(-2) }), NOW)).toBeNull();
    expect(coolingOf(row('b', { ...talked('hold'), next_action_at: day(5) }), NOW)).toBeNull();
  });
  it('una negociación sin respuesta es una parada, no segunda ronda', () => {
    expect(coolingOf(row('a', { ...talked(), ...outbound(40) }), NOW)?.group).toBe('stalled');
  });
  it('una dormida se enfría como parada; una en «no esta vez», no', () => {
    expect(coolingOf(row('a', { last: { direction: 'outbound', occurred_at: ago(90) }, last_in: { occurred_at: ago(95) } }), NOW)?.group).toBe('stalled');
    expect(coolingOf(row('b', { ...notNow, ...outbound(90) }), NOW)).toBeNull();
  });
});

describe('temporada', () => {
  it('va de septiembre a agosto', () => {
    expect(seasonOf('2026-09-01')).toEqual({ label: '26-27', start: '2026-09-01', end: '2027-08-31' });
    expect(seasonOf('2027-08-31').label).toBe('26-27');
    expect(seasonOf('2026-08-31').label).toBe('25-26');
    expect(currentSeason(NOW).label).toBe('26-27');
    expect(currentSeason(new Date(2027, 0, 5)).label).toBe('26-27');
  });
  it('una conversación sin funciones es de la temporada en curso; con funciones, de la de sus fechas', () => {
    const s = currentSeason(NOW);
    expect(inSeason(row('a'), s)).toBe(true);
    expect(inSeason(row('b', { performance_days: ['2027-03-14'] }), s)).toBe(true);
    expect(inSeason(row('c', { performance_days: ['2026-05-02'] }), s)).toBe(false);
    expect(inSeason(row('d', { performance_days: ['2026-05-02', '2026-11-20'] }), s)).toBe(true);
  });
  it('la acota la línea de difusión fijada', () => {
    const rows = [row('a', { line_id: 'l1' }), row('b', { line_id: 'l2' }), row('c')];
    expect(seasonRows(rows, currentSeason(NOW)).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(seasonRows(rows, currentSeason(NOW), ['l1']).map((r) => r.id)).toEqual(['a']);
  });
  it('cuenta por relación, con todas las relaciones presentes', () => {
    const c = countByRelation([row('a', outbound(2)), row('b', inbound(1)), row('c', outbound(3)), row('d')], NOW);
    expect(c.contacted).toBe(2);
    expect(c.talking).toBe(1);
    expect(c.never).toBe(1);
    expect(c.not_now).toBe(0);
    expect(Object.keys(c)).toHaveLength(6);
  });
  it('cuenta los bolos de la temporada en opción y firmes, sin dinero', () => {
    const o = buildOverview(
      [
        row('a', { bolos: [{ status: 'hold_1', first_performed_at: '2027-03-14' }, { status: 'confirmed', first_performed_at: '2026-11-02' }] }),
        row('b', { bolos: [{ status: 'confirmed', first_performed_at: '2026-04-01' }, { status: 'hold', first_performed_at: null }] }),
        row('c', { bolos: [{ status: 'cancelled', first_performed_at: '2026-12-01' }] }),
      ],
      NOW,
    );
    expect(o.season.bolos).toEqual({ option: 2, firm: 1 });
  });
});

describe('filtros de la lista', () => {
  it('lee solo valores conocidos', () => {
    expect(parseListFilter(new URLSearchParams('turno=nuestro&temp=fria&temporada=actual'))).toEqual({
      relacion: undefined,
      turno: 'nuestro',
      temp: 'fria',
      temporada: true,
    });
    const id = '01a14f54-6096-7361-9932-a9e3837f466d';
    expect(parseListFilter(new URLSearchParams(`envio=${id}&r=rebotes`))).toMatchObject({ envio: id, r: 'rebotes' });
    expect(parseListFilter(new URLSearchParams('envio=nope&r=rebotes')).envio).toBeUndefined();
    expect(parseListFilter(new URLSearchParams(`envio=${id}&r=todo`)).envio).toBeUndefined();
    expect(parseListFilter(new URLSearchParams('relacion=confirmed')).relacion).toBeUndefined();
    expect(parseListFilter(new URLSearchParams('relacion=not_now')).relacion).toBe('not_now');
    expect(parseListFilter(new URLSearchParams('turno=x&temp=tibia'))).toEqual({
      relacion: undefined,
      turno: undefined,
      temp: undefined,
      temporada: undefined,
    });
  });
  it('te toca: respuestas, la más reciente arriba; después seguimientos, el más vencido primero', () => {
    const rows = [
      row('seg-tarde', { next_action_at: day(-1) }),
      row('resp-nueva', inbound(1)),
      row('seg-viejo', { next_action_at: day(-5) }),
      row('resp-vieja', inbound(6)),
      row('les-toca', outbound(2)),
    ];
    expect(applyListFilter(rows, { turno: 'nuestro' }, NOW).map((r) => r.id)).toEqual([
      'resp-nueva',
      'resp-vieja',
      'seg-viejo',
      'seg-tarde',
    ]);
    expect(applyListFilter(rows, { turno: 'suyo' }, NOW).map((r) => r.id)).toEqual(['les-toca']);
  });
  it('se enfría: la más fría primero; caliente: la más reciente primero', () => {
    const rows = [
      row('a', outbound(25)),
      row('b', outbound(40)),
      row('c', inbound(3)),
      row('d', inbound(1)),
      row('e', { ...talked(), ...outbound(30) }),
      row('f'),
    ];
    expect(applyListFilter(rows, { temp: 'fria' }, NOW).map((r) => r.id)).toEqual(['e', 'b', 'a']);
    expect(applyListFilter(rows, { temp: 'ronda' }, NOW).map((r) => r.id)).toEqual(['b', 'a']);
    expect(applyListFilter(rows, { temp: 'parada' }, NOW).map((r) => r.id)).toEqual(['e']);
    expect(applyListFilter(rows, { temp: 'caliente' }, NOW).map((r) => r.id)).toEqual(['d', 'c']);
  });
  it('temporada y estado se combinan con el resto', () => {
    const rows = [row('a', { performance_days: ['2026-04-01'], ...inbound(1) }), row('b', inbound(2))];
    expect(applyListFilter(rows, { turno: 'nuestro', temporada: true }, NOW).map((r) => r.id)).toEqual(['b']);
  });
});

describe('la temporada por línea (ADR-135)', () => {
  const L1 = '11111111-1111-4111-8111-111111111111';
  const L2 = '22222222-2222-4222-8222-222222222222';
  const cat = { line_id: L1, line_name: 'MaMeMi 26-27 Catalunya' };
  const fr = { line_id: L2, line_name: 'MaMeMi 26-27 France' };

  it('con una sola línea o ninguna no reparte: una barra', () => {
    expect(seasonByLine([row('a'), row('b')], NOW)).toEqual([]);
    expect(seasonByLine([row('a', cat), row('b', cat)], NOW)).toEqual([]);
  });
  it('una barra por línea, la mayor arriba, con sus cifras', () => {
    const lines = seasonByLine(
      [
        row('a', cat),
        row('b', { ...fr, ...talked('hold'), bolos: [{ status: 'hold_2', first_performed_at: '2027-01-10' }] }),
        row('c', { ...fr, ...inbound(3) }),
        row('d', { ...fr, ...inbound(5), ...notNow }),
      ],
      NOW,
    );
    expect(lines.map((l) => l.name)).toEqual(['MaMeMi 26-27 France', 'MaMeMi 26-27 Catalunya']);
    expect(lines[0]).toMatchObject({ line_id: L2, total: 3, answered: 3, bolos: { option: 1, firm: 0 } });
    expect(lines[0].counts).toMatchObject({ talking: 2, not_now: 1 });
    expect(lines[1]).toMatchObject({ line_id: L1, total: 1, answered: 0 });
  });
  it('las que no tienen línea van juntas, al final, aunque sean más', () => {
    const lines = seasonByLine([row('a', cat), row('b'), row('c'), row('d')], NOW);
    expect(lines.map((l) => [l.line_id, l.total])).toEqual([
      [L1, 1],
      [null, 3],
    ]);
    expect(lines[1].name).toBeNull();
  });
  it('a igual tamaño, por nombre', () => {
    const lines = seasonByLine([row('a', fr), row('b', cat)], NOW);
    expect(lines.map((l) => l.line_id)).toEqual([L1, L2]);
  });
  it('buildOverview reparte solo lo de la temporada y respeta las líneas fijadas', () => {
    const rows = [
      row('a', cat),
      row('b', fr),
      row('vieja', { ...fr, performance_days: ['2026-04-01'] }),
      row('c'),
    ];
    const all = buildOverview(rows, NOW);
    expect(all.season.total).toBe(3);
    expect(all.season.lines.map((l) => [l.line_id, l.total])).toEqual([
      [L1, 1],
      [L2, 1],
      [null, 1],
    ]);
    // Una sola línea fijada: su temporada, una barra.
    const pinned = buildOverview(rows, NOW, { lineIds: [L1] });
    expect(pinned.season.total).toBe(1);
    expect(pinned.season.lines).toEqual([]);
    // Dos fijadas: las dos, sin «sin línea».
    expect(buildOverview(rows, NOW, { lineIds: [L1, L2] }).season.lines.map((l) => l.line_id)).toEqual([L1, L2]);
  });
  it('?linea= solo vale con la temporada, y filtra la lista por esa línea o por las que no tienen', () => {
    expect(parseListFilter(new URLSearchParams(`temporada=actual&linea=${L1}`)).linea).toBe(L1);
    expect(parseListFilter(new URLSearchParams('temporada=actual&linea=sin')).linea).toBe(NO_LINE);
    expect(parseListFilter(new URLSearchParams('temporada=actual&linea=nope')).linea).toBeUndefined();
    expect(parseListFilter(new URLSearchParams(`linea=${L1}`)).linea).toBeUndefined();
    const rows = [row('a', cat), row('b', fr), row('c'), row('vieja', { ...cat, performance_days: ['2026-04-01'] })];
    expect(applyListFilter(rows, { temporada: true, linea: L1 }, NOW).map((r) => r.id)).toEqual(['a']);
    expect(applyListFilter(rows, { temporada: true, linea: NO_LINE }, NOW).map((r) => r.id)).toEqual(['c']);
  });
  it('el tramo de una línea y su filtro cuentan lo mismo', () => {
    const rows = [row('a', cat), row('b', { ...cat, ...inbound(2) }), row('c', { ...fr, ...inbound(4) }), row('d')];
    const o = buildOverview(rows, NOW);
    for (const l of o.season.lines) {
      const linea = l.line_id ?? NO_LINE;
      expect(applyListFilter(rows, { temporada: true, linea }, NOW)).toHaveLength(l.total);
      expect(applyListFilter(rows, { temporada: true, linea, relacion: 'talking' }, NOW)).toHaveLength(l.counts.talking);
    }
  });
});

describe('buildOverview', () => {
  it('«vivas» no cuenta las de «no esta vez» ni las dormidas', () => {
    const o = buildOverview(
      [row('a'), row('no', notNow), row('dormida', { last_in: { occurred_at: ago(60) } }), row('hold', talked('hold'))],
      NOW,
    );
    expect(o).toMatchObject({ total: 4, live: 2 });
  });

  it('cuenta todo y enseña solo las primeras filas de cada bloque', () => {
    const rows = [
      ...Array.from({ length: BLOCK_ROWS + 2 }, (_, i) => row(`due${i}`, inbound(i + 1, `Re: ${i}`))),
      ...Array.from({ length: 3 }, (_, i) => row(`cold${i}`, { project_id: i === 2 ? 'p2' : 'p1', ...outbound(30 + i) })),
      row('confirmada', { ...talked('confirmed'), performance_days: ['2027-02-14'] }),
      row('pasada', { ...talked('confirmed'), performance_days: ['2026-03-01'] }),
    ];
    const o = buildOverview(rows, NOW);
    expect(o.total).toBe(rows.length);
    expect(o.due.count).toBe(BLOCK_ROWS + 2);
    expect(o.due.rows).toHaveLength(BLOCK_ROWS);
    expect(o.due.rows[0]).toMatchObject({ id: 'due0', reason: 'reply', subject: 'Re: 0' });
    expect(o.cold.count).toBe(3);
    expect(o.cold.round).toBe(3);
    expect(o.cold.picks).toEqual([
      { id: 'cold2', project_id: 'p2' },
      { id: 'cold1', project_id: 'p1' },
      { id: 'cold0', project_id: 'p1' },
    ]);
    expect(o.season.label).toBe('26-27');
    expect(o.season.total).toBe(rows.length - 1);
    expect(o.season.counts.talking).toBe(BLOCK_ROWS + 3);
    // The replies, plus the confirmed one: a deal is an answer.
    expect(o.season.answered).toBe(BLOCK_ROWS + 3);
    expect(o.hot.rows.length).toBeLessThanOrEqual(6);
  });
  it('«sin respuesta» no cuenta los estados viejos que ya eran una respuesta', () => {
    const rows = ['contacted', 'in_conversation', 'hold', 'confirmed', 'declined', 'dormant', 'recurring'].map((legacy_status, i) =>
      row(`s${i}`, { legacy_status }),
    );
    expect(buildOverview(rows, NOW).season.answered).toBe(3);
    expect(buildOverview([row('a', inbound(4))], NOW).season.answered).toBe(1);
  });
  it('diez respuestas no esconden los seguimientos vencidos', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => row(`r${i}`, inbound(i + 1))),
      row('seg', { next_action_at: day(-4) }),
      row('hoy', { next_action_at: day(0) }),
      row('otro', { next_action_at: day(-1) }),
    ];
    const o = buildOverview(rows, NOW);
    expect(o.due.rows.map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'seg', 'otro']);
    expect(buildOverview(rows.slice(0, 2).concat(rows.slice(10)), NOW).due.rows.map((r) => r.id)).toEqual(['r0', 'r1', 'seg', 'otro', 'hoy']);
  });
  it('un seguimiento lleva su nota y su día', () => {
    const o = buildOverview([row('a', { next_action_at: `${day(-7)}T00:00:00+00:00`, next_action_note: 'Mandar vídeo' })], NOW);
    expect(o.due.rows[0]).toMatchObject({ reason: 'follow_up', at: day(-7), days: 7, note: 'Mandar vídeo', subject: null });
  });
  it('sin conversaciones, todo a cero', () => {
    const o = buildOverview([], NOW);
    expect(o).toMatchObject({ total: 0, live: 0, due: { count: 0, rows: [] }, hot: { count: 0 }, cold: { count: 0, picks: [] } });
  });
});

describe('mailoutFigures', () => {
  const queued = ago(10);
  it('cuenta salidas, rebotes, bajas y respuestas posteriores', () => {
    const lastIn = new Map([
      ['c1', ago(5)],
      ['c2', ago(20)],
    ]);
    const f = mailoutFigures(
      [
        { conversation_id: 'c1', status: 'delivered', sent_at: ago(10, 10) },
        { conversation_id: 'c2', status: 'delivered', sent_at: ago(10, 10) },
        { conversation_id: 'c3', status: 'bounced', sent_at: ago(10, 10) },
        { conversation_id: 'c4', status: 'complained', sent_at: ago(10, 10) },
        { conversation_id: 'c5', status: 'skipped', suppressed_reason: 'unsubscribe', suppressed_at: ago(30) },
        { conversation_id: 'c6', status: 'delivered', suppressed_reason: 'unsubscribe', suppressed_at: ago(3) },
      ],
      queued,
      lastIn,
    );
    expect(f).toEqual({ recipients: 6, sent: 5, delivered: 4, bounced: 1, complained: 1, unsubscribed: 1, replies: 1 });
  });
});
