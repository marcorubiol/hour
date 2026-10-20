import { describe, expect, test } from 'vitest';
import { scopeUrlToWrite } from './scope-url';

describe('scopeUrlToWrite', () => {
  test('un ámbito guardado en una carga completa no se escribe antes de que el router tenga su raíz', () => {
    // La pantalla en blanco del 2026-10-20: pines guardados, URL sin `?scope=`,
    // primera vuelta del efecto dentro del montaje.
    expect(scopeUrlToWrite('https://hour.test/h/desk', 's:playwright', false)).toBeNull();
  });
  test('con el router listo, el mismo ámbito pasa a la URL', () => {
    expect(scopeUrlToWrite('https://hour.test/h/desk', 's:playwright', true)?.href).toBe(
      'https://hour.test/h/desk?scope=s:playwright',
    );
  });
  test('si la URL ya lo dice, no hay nada que escribir', () => {
    expect(scopeUrlToWrite('https://hour.test/h/desk?scope=s:playwright', 's:playwright', true)).toBeNull();
    expect(scopeUrlToWrite('https://hour.test/h/desk', '', true)).toBeNull();
  });
  test('vaciar el ámbito quita el parámetro y deja los demás', () => {
    expect(scopeUrlToWrite('https://hour.test/h/planner?view=agenda&scope=s:a', '', true)?.href).toBe(
      'https://hour.test/h/planner?view=agenda',
    );
  });
  test('los tokens se leen tal cual, sin escapar', () => {
    expect(scopeUrlToWrite('https://hour.test/h/books#bolo-b1', 's:muk-cia,p:muk-cia/mamemi', true)?.href).toBe(
      'https://hour.test/h/books?scope=s:muk-cia,p:muk-cia/mamemi#bolo-b1',
    );
  });
});
