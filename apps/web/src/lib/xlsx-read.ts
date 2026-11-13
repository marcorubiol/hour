/**
 * La primera hoja de un .xlsx, como filas de texto (tarea 138). Sin librería:
 * un .xlsx es un zip (`$lib/zip-read`) con XML dentro, y para contactos basta
 * con leer las celdas: texto compartido, texto en línea, números y
 * verdaderos/falsos. Fórmulas, estilos y fechas con formato no se
 * interpretan: llega el valor guardado (una fecha, como número de serie).
 *
 * Se lee con expresiones regulares, no con DOMParser, para que funcione igual
 * en el navegador y en los tests: el XML de una hoja es plano y regular.
 */

import { zipEntries, zipRead, type ZipEntry } from '$lib/zip-read';

export class XlsxError extends Error {}

/** Lo que hay en los primeros bytes: decide cómo se lee el fichero. */
export function sheetKind(head: Uint8Array): 'zip' | 'xls' | 'text' {
  if (head[0] === 0x50 && head[1] === 0x4b) return 'zip';
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return 'xls';
  return 'text';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Las entidades de XML a texto. */
export function xmlText(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** El texto de un `<si>` o de un `<is>`: sus `<t>` juntos, sin la fonética (`<rPh>`). */
function runsText(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += m[1] ? xmlText(m[1]) : '';
  return out;
}

/** Los textos compartidos, en orden. */
export function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => (m[1] ? runsText(m[1]) : ''));
}

/** «A» → 0, «AB» → 27. */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function attr(attrs: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;
}

/** Las filas de una hoja; las celdas que faltan, vacías. */
export function sheetRows(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(rm[1], 'r'));
    const at = Number.isInteger(r) && r > 0 ? r - 1 : rows.length;
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r');
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = attr(cm[1], 't');
      const body = cm[2] ?? '';
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = raw !== undefined ? (shared[Number(raw)] ?? '') : '';
      else if (type === 'inlineStr') value = runsText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (type === 'b') value = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : '';
      else value = raw !== undefined ? xmlText(raw) : '';
      while (row.length < col) row.push('');
      row[col] = value;
    }
    while (rows.length < at) rows.push([]);
    rows[at] = row;
  }
  return rows;
}

/** La ruta, dentro del zip, de la primera hoja del libro, y su nombre. */
export function firstSheetPath(workbook: string, rels: string): { path: string; name: string } {
  const sheet = /<(?:\w+:)?sheet\b([^>]*)\/?>/.exec(workbook);
  if (!sheet) throw new XlsxError('no sheet');
  const name = xmlText(attr(sheet[1], 'name') ?? '');
  const rid = /\br:id="([^"]*)"/.exec(sheet[1])?.[1] ?? attr(sheet[1], 'id');
  let target: string | null = null;
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    if (attr(m[1], 'Id') === rid) target = attr(m[1], 'Target');
  }
  if (!target) target = 'worksheets/sheet1.xml';
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  return { path, name };
}

/** Cuántas hojas tiene el libro. */
export function sheetCount(workbook: string): number {
  return [...workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?>/g)].length;
}

/** La primera hoja de un .xlsx: sus filas, su nombre y cuántas hojas hay. */
export async function readXlsx(buf: Uint8Array): Promise<{ rows: string[][]; sheet: string; sheets: number }> {
  let entries: ZipEntry[];
  try {
    entries = zipEntries(buf);
  } catch {
    throw new XlsxError('not a zip');
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  const text = async (name: string): Promise<string | null> => {
    const e = byName.get(name);
    return e ? new TextDecoder().decode(await zipRead(buf, e)) : null;
  };
  const workbook = await text('xl/workbook.xml');
  if (!workbook) throw new XlsxError('not a workbook');
  const rels = (await text('xl/_rels/workbook.xml.rels')) ?? '';
  const { path, name } = firstSheetPath(workbook, rels);
  const sheetXml = await text(path);
  if (!sheetXml) throw new XlsxError('sheet missing');
  const shared = sharedStrings((await text('xl/sharedStrings.xml')) ?? '');
  return { rows: sheetRows(sheetXml, shared), sheet: name, sheets: sheetCount(workbook) };
}
