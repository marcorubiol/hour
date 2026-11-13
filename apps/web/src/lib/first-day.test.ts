import { describe, expect, it } from 'vitest';
import { HELP_KEY } from './help';
import {
  START_HIDDEN_KEY,
  START_STEPS,
  doneCount,
  primaryStep,
  seesStart,
  startLaterKey,
  startPhase,
  startRows,
  startState,
  startTarget,
  teamDoor,
  type StartResponse,
} from './first-day';

const empty: StartResponse = { project: null, contact: null, date: null, team: null };
const full: StartResponse = {
  project: { id: 'p1', slug: 'la-mudanza', name: 'La mudanza' },
  contact: { kind: 'conversation', id: 'c1', name: 'Teatre Lliure' },
  date: { kind: 'performance', slug: 'girona-1', name: 'Girona', day: '2026-12-04' },
  team: { name: 'Anouk', project_slug: 'la-mudanza' },
};
const SEEN_AT = '2026-11-13T10:00:00Z';

describe('las claves caben en help_seen sin migración', () => {
  it('ocultar y cada «más tarde» pasan la regla de mark_help_seen', () => {
    expect(HELP_KEY.test(START_HIDDEN_KEY)).toBe(true);
    for (const s of START_STEPS) expect(HELP_KEY.test(startLaterKey(s))).toBe(true);
  });
});

describe('startState: lo hecho enlaza a lo creado', () => {
  it('sin nada, ningún paso', () => {
    expect(startState(empty, 'abc')).toEqual({ project: null, contacts: null, date: null, team: null });
  });
  it('el equipo enlaza al reparto del proyecto de esa persona', () => {
    expect(startState(full, 'abc').team).toEqual({ name: 'Anouk', href: '/h/abc/project/la-mudanza/#team' });
    expect(startState({ ...empty, team: { name: 'Anouk', project_slug: null } }, 'abc').team).toEqual({
      name: 'Anouk',
      href: null,
    });
  });
  it('espectáculo, conversación y función, cada uno a su página', () => {
    const s = startState(full, 'abc');
    expect(s.project).toEqual({ id: 'p1', name: 'La mudanza', href: '/h/abc/project/la-mudanza/' });
    expect(s.contacts).toEqual({ name: 'Teatre Lliure', href: '/h/abc/conversation/c1' });
    expect(s.date).toEqual({ name: 'Girona', href: '/h/abc/performance/girona-1' });
  });
  it('un contacto suelto va a su ficha; una organización, a la suya', () => {
    expect(startState({ ...empty, contact: { kind: 'person', slug: 'ana', name: 'Ana' } }, 'abc').contacts?.href).toBe(
      '/h/abc/person/ana/',
    );
    expect(
      startState({ ...empty, contact: { kind: 'organization', slug: 'grec', name: 'Grec' } }, 'abc').contacts?.href,
    ).toBe('/h/abc/organization/grec');
  });
  it('una fecha que no es función abre su día en el Planificador', () => {
    const s = startState({ ...empty, date: { kind: 'date', name: 'Ensayo', day: '2026-11-20' } }, 'abc');
    expect(s.date?.href).toBe('/h/planner?view=day&d=2026-11-20');
  });
});

describe('startRows: qué pasos están hechos', () => {
  it('se tacha con los datos, no con un clic', () => {
    const rows = startRows(startState({ ...empty, project: full.project }, 'abc'), {});
    expect(rows.map((r) => r.status)).toEqual(['done', 'pending', 'pending', 'pending']);
    expect(doneCount(rows)).toBe(1);
  });
  it('cuatro pasos, el equipo el último', () => {
    expect(START_STEPS).toEqual(['project', 'contacts', 'date', 'team']);
    expect(doneCount(startRows(startState(full, 'abc'), {}))).toBe(4);
  });
  it('«más tarde» pliega el paso; hecho gana a «más tarde»', () => {
    const seen = { [startLaterKey('contacts')]: SEEN_AT, [startLaterKey('project')]: SEEN_AT };
    const rows = startRows(startState({ ...empty, project: full.project }, 'abc'), seen);
    expect(rows.map((r) => r.status)).toEqual(['done', 'later', 'pending', 'pending']);
  });
  it('el botón lleno pasa al primer pendiente', () => {
    expect(primaryStep(startRows(startState(empty, 'abc'), {}))).toBe('project');
    expect(primaryStep(startRows(startState({ ...empty, project: full.project }, 'abc'), {}))).toBe('contacts');
    expect(primaryStep(startRows(startState({ ...full, team: null }, 'abc'), {}))).toBe('team');
    expect(primaryStep(startRows(startState(full, 'abc'), {}))).toBeNull();
  });
});

describe('el equipo: cuelga del proyecto', () => {
  it('sin proyecto, el paso está pero espera, y no lleva el botón lleno', () => {
    const seen = { [startLaterKey('project')]: SEEN_AT };
    const rows = startRows(startState({ ...empty, contact: full.contact, date: full.date }, 'abc'), seen);
    const team = rows.find((r) => r.step === 'team');
    expect(team).toMatchObject({ status: 'pending', blocked: true });
    expect(primaryStep(rows)).toBeNull();
  });
  it('con proyecto, se puede hacer ya', () => {
    const rows = startRows(startState({ ...empty, project: full.project }, 'abc'), {});
    expect(rows.find((r) => r.step === 'team')?.blocked).toBe(false);
  });
  it('hecho no espera, aunque el proyecto no se lea', () => {
    const rows = startRows(startState({ ...empty, team: full.team }, 'abc'), {});
    expect(rows.find((r) => r.step === 'team')).toMatchObject({ status: 'done', blocked: false });
  });
  it('su puerta es el reparto de la ficha del primer proyecto, o ninguna', () => {
    expect(teamDoor(startState(full, 'abc'))).toBe('/h/abc/project/la-mudanza/#team');
    expect(teamDoor(startState(empty, 'abc'))).toBeNull();
  });
});

describe('quién la ve y en qué espacio', () => {
  it('owner o admin, con el papel dicho', () => {
    expect(seesStart('owner')).toBe(true);
    expect(seesStart('admin')).toBe(true);
    for (const r of ['member', 'viewer', 'guest', null, undefined] as const) expect(seesStart(r)).toBe(false);
  });
  it('el espacio más reciente que administra; ninguno si no administra', () => {
    const ws = [
      { id: 'a', my_role: 'owner' as const },
      { id: 'b', my_role: 'admin' as const },
      { id: 'c', my_role: 'guest' as const },
    ];
    expect(startTarget(ws)?.id).toBe('b');
    expect(startTarget([{ id: 'c', my_role: 'member' as const }])).toBeNull();
    expect(startTarget([])).toBeNull();
  });
});

describe('startPhase: cuándo se muestra y cuándo se va', () => {
  const base = { seen: {}, ready: true, sees: true, sawPending: false };
  const rowsOf = (res: StartResponse, seen = {}) => startRows(startState(res, 'abc'), seen);

  it('sale con algún paso pendiente', () => {
    expect(startPhase({ ...base, rows: rowsOf(empty) })).toBe('list');
  });
  it('no sale sin lo visto, sin papel o sin la lectura', () => {
    expect(startPhase({ ...base, rows: rowsOf(empty), ready: false })).toBe('none');
    expect(startPhase({ ...base, rows: rowsOf(empty), sees: false })).toBe('none');
    expect(startPhase({ ...base, rows: null })).toBe('none');
  });
  it('«Ocultar» la cierra entera', () => {
    expect(startPhase({ ...base, rows: rowsOf(empty), seen: { [START_HIDDEN_KEY]: SEEN_AT } })).toBe('none');
  });
  it('se va cuando lo que falta está para más tarde', () => {
    const seen = {
      [startLaterKey('contacts')]: SEEN_AT,
      [startLaterKey('date')]: SEEN_AT,
      [startLaterKey('team')]: SEEN_AT,
    };
    expect(startPhase({ ...base, rows: rowsOf({ ...empty, project: full.project }, seen), seen, sawPending: true })).toBe(
      'none',
    );
  });
  it('el equipo solo, pendiente, mantiene la lista', () => {
    expect(startPhase({ ...base, rows: rowsOf({ ...full, team: null }) })).toBe('list');
  });
  it('los cuatro hechos en esta visita: la línea de cierre, una vez', () => {
    expect(startPhase({ ...base, rows: rowsOf({ ...full, team: null }), sawPending: true })).toBe('list');
    expect(startPhase({ ...base, rows: rowsOf(full), sawPending: true })).toBe('closing');
    expect(startPhase({ ...base, rows: rowsOf(full), sawPending: true, seen: { [START_HIDDEN_KEY]: SEEN_AT } })).toBe(
      'none',
    );
  });
  it('un espacio con datos no la ve nunca, ni su cierre', () => {
    expect(startPhase({ ...base, rows: rowsOf(full) })).toBe('none');
  });
  it('tras «Volver a ver las ayudas», vuelve solo si queda algo', () => {
    const later = { [startLaterKey('date')]: SEEN_AT, [startLaterKey('team')]: SEEN_AT, [START_HIDDEN_KEY]: SEEN_AT };
    const partial = { ...empty, project: full.project, contact: full.contact };
    expect(startPhase({ ...base, rows: rowsOf(partial, later), seen: later })).toBe('none');
    expect(startPhase({ ...base, rows: rowsOf(partial, {}), seen: {} })).toBe('list');
    expect(startPhase({ ...base, rows: rowsOf(full, {}), seen: {} })).toBe('none');
  });
});
