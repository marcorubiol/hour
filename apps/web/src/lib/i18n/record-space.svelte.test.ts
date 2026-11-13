/**
 * Una ficha habla el oficio de su espacio (tarea 142 C): abierta en vista
 * previa sobre una pantalla de oficios mezclados, lo que monta lee la voz de
 * su espacio con `tHere()`; fuera de una ficha, o con el espacio aún sin
 * saber, la de la pantalla, como `t()`.
 */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Harness from '$lib/components/test/RecordSpaceHarness.svelte';
import Probe from '$lib/components/test/RecordSpaceProbe.svelte';
import { setTrade, setWorkspaceTrades } from './index';

beforeEach(() => {
  setWorkspaceTrades([
    { id: 'w-music', slug: 'banda', trade: 'music' },
    { id: 'w-stage', slug: 'cia', trade: 'stage' },
  ]);
});

afterEach(() => {
  cleanup();
  setTrade('stage');
  setWorkspaceTrades([]);
});

describe('tHere() in a record (tarea 142 C)', () => {
  test('a music record over a mixed screen speaks music, by slug or by id', () => {
    setTrade('mixed');
    render(Harness, { space: 'banda' });
    expect(screen.getByText('Formación')).toBeTruthy();
    cleanup();
    render(Harness, { space: 'w-music' });
    expect(screen.getByText('Formación')).toBeTruthy();
  });

  test('a stage record over a music screen speaks stage', () => {
    setTrade('music');
    render(Harness, { space: 'cia' });
    expect(screen.getByText('Reparto')).toBeTruthy();
  });

  test('outside a record, or before its space is known, the screen speaks', () => {
    setTrade('music');
    render(Probe);
    expect(screen.getByText('Formación')).toBeTruthy();
    cleanup();
    render(Harness, { space: null });
    expect(screen.getByText('Formación')).toBeTruthy();
  });
});
