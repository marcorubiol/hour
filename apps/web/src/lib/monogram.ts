/**
 * Las iniciales del monograma de con quién se habla (ADR-176): una
 * organización, una persona o un grupo de un bolo. No es la identidad de un
 * proyecto (eso es `IdentityMark` y `$lib/utils/identity`, teñida con su
 * acento). Dos palabras con sentido, dos letras: los artículos y las
 * preposiciones no cuentan («Teatre de la Llum», TL); si no quedan dos con
 * sentido, las dos primeras del nombre («El Periódico», EP). Una palabra, su primera letra; los signos no cuentan.
 */

/** Palabras vacías de los cuatro idiomas de Hour (es, ca, en, fr); `l'` y `d'` se quitan delante de la palabra. */
const STOP = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'lo', 'y', 'e', 'en', 'a', 'al', 'un', 'una',
  'les', 'els', 'i', 'per', 'amb', 'dels', 'als', 'na', 'en',
  'the', 'of', 'and', 'an', 'in', 'on', 'at', 'for', 'to',
  'le', 'du', 'des', 'et', 'aux', 'au', 'pour', 'sur',
]);

export function initials(name: string | null | undefined): string {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[ldLD][’']/u, ''))
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return '';
  const bare = (w: string) => w.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const full = words.filter((w) => !STOP.has(bare(w)));
  const use = full.length >= 2 ? full : words;
  const first = (w: string) => [...w].find((ch) => /[\p{L}\p{N}]/u.test(ch)) ?? '';
  return (use.length === 1 ? first(use[0]) : first(use[0]) + first(use[1])).toLocaleUpperCase();
}
