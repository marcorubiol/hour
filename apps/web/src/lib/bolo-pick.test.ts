import { describe, expect, test } from 'vitest';
import {
  boloDefault,
  booksHref,
  scopeShowsProject,
  boloLabel,
  boloOf,
  boloOptions, boloPatch, boloPrefill, type BoloLite } from './bolo-pick';

const lliure: BoloLite = {
  id: 'b1',
  venue_name: 'Teatre Lliure',
  city: 'Barcelona',
  status: 'confirmed',
  function_count: 2,
};
const sevilla: BoloLite = {
  id: 'b2',
  venue_name: null,
  city: 'Sevilla',
  status: 'hold',
  function_count: 1,
};
const dead: BoloLite = {
  id: 'b3',
  venue_name: 'Sala Muerta',
  city: null,
  status: 'cancelled',
  function_count: 0,
};

describe('boloLabel', () => {
  test('sala, ciudad y cuántas funciones lleva', () => {
    expect(boloLabel(lliure, 'es')).toBe('Teatre Lliure · Barcelona · 2 funciones');
    expect(boloLabel(sevilla, 'es')).toBe('Sevilla · 1 función');
    expect(boloLabel(lliure, 'ca')).toBe('Teatre Lliure · Barcelona · 2 funcions');
    expect(boloLabel(lliure, 'en')).toBe('Teatre Lliure · Barcelona · 2 performances');
  });

  test('un bolo sin sala ni ciudad no se queda en blanco', () => {
    expect(boloLabel({ ...dead, city: null, venue_name: null }, 'es')).toBe(
      'Bolo sin sala · 0 funciones',
    );
  });
});

describe('boloOptions', () => {
  test('«sin bolo» primero y el orden de la RPC intacto', () => {
    const opts = boloOptions([sevilla, lliure], 'es');
    expect(opts.map((o) => o.value)).toEqual(['', 'b2', 'b1']);
    expect(opts[0].label).toBe('Sin bolo');
  });

  test('un trato cancelado no recibe funciones nuevas', () => {
    expect(boloOptions([lliure, dead], 'es').map((o) => o.value)).toEqual(['', 'b1']);
  });

  test('pero si ya era el suyo, sigue en la lista', () => {
    expect(boloOptions([lliure, dead], 'es', 'b3').map((o) => o.value)).toEqual(['', 'b1', 'b3']);
  });

  test('sin filas solo queda «sin bolo»: la pantalla no dibuja el selector', () => {
    expect(boloOptions([], 'es')).toHaveLength(1);
  });
});

describe('boloPrefill', () => {
  test('rellena lo vacío con la sala y la ciudad del bolo', () => {
    expect(boloPrefill(lliure, { venue: '', city: ' ' })).toEqual({
      venue: 'Teatre Lliure',
      city: 'Barcelona',
    });
  });

  test('lo escrito a mano manda', () => {
    expect(boloPrefill(lliure, { venue: 'Sala Beckett', city: '' })).toEqual({
      venue: 'Sala Beckett',
      city: 'Barcelona',
    });
  });

  test('un bolo sin sala no borra nada, y sin bolo no cambia nada', () => {
    expect(boloPrefill(sevilla, { venue: '', city: '' })).toEqual({ venue: '', city: 'Sevilla' });
    expect(boloPrefill(null, { venue: 'x', city: 'y' })).toEqual({ venue: 'x', city: 'y' });
  });
});

describe('boloOf', () => {
  test('cuántas funciones lleva el trato, o que no tiene', () => {
    expect(boloOf(lliure, 'es')).toBe('bolo de 2 funciones');
    expect(boloOf(sevilla, 'ca')).toBe("bolo d'1 funció");
    expect(boloOf(null, 'en')).toBe('no deal');
  });
});

describe('boloDefault', () => {
  test('un solo bolo abierto: ese', () => {
    expect(boloDefault([lliure, dead])).toBe('b1');
  });
  test('dos abiertos, o ninguno: sin bolo', () => {
    expect(boloDefault([lliure, sevilla])).toBe('');
    expect(boloDefault([dead])).toBe('');
    expect(boloDefault([])).toBe('');
  });
});

describe('booksHref', () => {
  test('Cuentas con el proyecto en el ámbito', () => {
    expect(booksHref('p1')).toBe('/h/books?scope=p:p1');
  });
  test('con el alta de bolo abierta', () => {
    expect(booksHref('p1', { newBolo: true })).toBe('/h/books?scope=p:p1&new_bolo=p1');
  });
  test('hasta la tarjeta de un bolo', () => {
    expect(booksHref('p1', { boloId: 'b1' })).toBe('/h/books?scope=p:p1#bolo-b1');
  });
  test('con el diálogo que resuelve su «Pide atención»', () => {
    expect(booksHref('p1', { boloId: 'b1', act: 'to_invoice' })).toBe('/h/books?scope=p:p1&act=to_invoice#bolo-b1');
  });
  test('sin bolo, `act` no significa nada y no se manda', () => {
    expect(booksHref('p1', { act: 'to_invoice' })).toBe('/h/books?scope=p:p1');
  });
  // «Abrir en Cuentas» desde un bolo te cambiaba el ámbito de todas las
  // lentes (2026-10-20): si tu ámbito ya enseña el proyecto, el enlace no lo toca.
  test('con Todo, el enlace no lleva ámbito y no pisa el tuyo', () => {
    expect(booksHref('p1', { boloId: 'b1', here: { pins: [], workspaceSlug: 'muk' } })).toBe('/h/books#bolo-b1');
  });
  test('con el espacio o el proyecto pinado, tampoco', () => {
    expect(booksHref('p1', { boloId: 'b1', act: 'draft', here: { pins: ['s:muk'], workspaceSlug: 'muk' } })).toBe(
      '/h/books?act=draft#bolo-b1',
    );
    expect(booksHref('p1', { newBolo: true, here: { pins: ['p:p1', 's:otro'], workspaceSlug: 'muk' } })).toBe(
      '/h/books?new_bolo=p1',
    );
  });
  test('si tu ámbito no lo enseña, acota al proyecto: si no, la tarjeta no estaría', () => {
    expect(booksHref('p1', { boloId: 'b1', here: { pins: ['s:otro'], workspaceSlug: 'muk' } })).toBe(
      '/h/books?scope=p:p1#bolo-b1',
    );
  });
});

describe('scopeShowsProject', () => {
  test('una persona no acota Cuentas', () => {
    expect(scopeShowsProject(['pe:x'], 'p1', 'muk')).toBe(true);
  });
  test('una línea no basta: el bolo puede ser de otra', () => {
    expect(scopeShowsProject(['l:l1'], 'p1', 'muk')).toBe(false);
  });
  test('sin el espacio del proyecto, solo cuenta el propio proyecto', () => {
    expect(scopeShowsProject(['s:muk'], 'p1', null)).toBe(false);
    expect(scopeShowsProject(['p:p1'], 'p1', null)).toBe(true);
  });
});

describe('boloPatch', () => {
  test('sin cambio no se manda nada', () => {
    expect(boloPatch('b1', 'b1')).toEqual({});
    expect(boloPatch(null, '')).toEqual({});
  });

  test('enlazar, mover y soltar', () => {
    expect(boloPatch(null, 'b1')).toEqual({ bolo_id: 'b1' });
    expect(boloPatch('b1', 'b2')).toEqual({ bolo_id: 'b2' });
    expect(boloPatch('b1', '')).toEqual({ bolo_id: null });
  });
});
