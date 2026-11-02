/**
 * Las iniciales del monograma de con quién se habla (ADR-176): una
 * organización, una persona o un grupo de un bolo. No es la identidad de un
 * proyecto (eso es `IdentityMark` y `$lib/utils/identity`, teñida con su
 * acento). Dos palabras, dos letras; una, la primera; los signos no cuentan.
 */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return '';
  const first = (w: string) => [...w].find((ch) => /[\p{L}\p{N}]/u.test(ch)) ?? '';
  return (words.length === 1 ? first(words[0]) : first(words[0]) + first(words[1])).toLocaleUpperCase();
}
