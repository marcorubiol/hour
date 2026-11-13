import { describe, expect, test } from 'vitest';
import { columnIndex, firstSheetPath, readXlsx, sharedStrings, sheetKind, sheetRows, xmlText } from './xlsx-read';
import { zipEntries, zipRead } from './zip-read';

/** Un zip «guardado» (sin comprimir), lo justo para que `zip-read` lo abra. */
function storedZip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = enc.encode(name);
    const data = enc.encode(content);
    const local = new Uint8Array(30 + n.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    local.set(data, 30 + n.length);
    const central = new Uint8Array(46 + n.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    central.set(n, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

const WORKBOOK = `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Difusión" sheetId="1" r:id="rId1"/><sheet name="Otra" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const RELS = `<Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
const SHARED = `<sst><si><t>Nombre</t></si><si><t>Email</t></si><si><r><t>Marta </t></r><r><t>Soler</t></r></si><si><t xml:space="preserve">Sala &amp; Farola</t></si></sst>`;
const SHEET = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Últ. contacto</t></is></c></row>
<row r="2"/>
<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="str"><f>LOWER("X")</f><v>marta@example.org</v></c><c r="C3" t="s"><v>3</v></c><c r="D3" s="2"><v>45730</v></c></row>
</sheetData></worksheet>`;

describe('xlsx-read', () => {
  test('tells a zip, an old .xls and text apart', () => {
    expect(sheetKind(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('zip');
    expect(sheetKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe('xls');
    expect(sheetKind(new TextEncoder().encode('Nombre;Email'))).toBe('text');
  });

  test('entities and column letters', () => {
    expect(xmlText('a &amp; b &lt;c&gt; &#233; &#x41;')).toBe('a & b <c> é A');
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AB12')).toBe(27);
  });

  test('shared strings join their runs and skip phonetics', () => {
    expect(sharedStrings(SHARED)).toEqual(['Nombre', 'Email', 'Marta Soler', 'Sala & Farola']);
    expect(sharedStrings('<sst><si><t>漢</t><rPh><t>かん</t></rPh></si></sst>')).toEqual(['漢']);
  });

  test('rows keep their place: a missing cell is empty, a missing row is empty', () => {
    const rows = sheetRows(SHEET, sharedStrings(SHARED));
    expect(rows[0]).toEqual(['Nombre', 'Email', '', 'Últ. contacto']);
    expect(rows[1]).toEqual([]);
    expect(rows[2]).toEqual(['Marta Soler', 'marta@example.org', 'Sala & Farola', '45730']);
  });

  test('the first sheet is the first in the workbook, whatever the rels order', () => {
    expect(firstSheetPath(WORKBOOK, RELS)).toEqual({ path: 'xl/worksheets/sheet1.xml', name: 'Difusión' });
    expect(firstSheetPath(WORKBOOK, '<Relationships><Relationship Id="rId1" Target="/xl/ws/a.xml"/></Relationships>').path).toBe('xl/ws/a.xml');
  });

  test('reads a whole .xlsx', async () => {
    const buf = storedZip({
      'xl/workbook.xml': WORKBOOK,
      'xl/_rels/workbook.xml.rels': RELS,
      'xl/sharedStrings.xml': SHARED,
      'xl/worksheets/sheet1.xml': SHEET,
      'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>',
    });
    const read = await readXlsx(buf);
    expect(read.sheet).toBe('Difusión');
    expect(read.sheets).toBe(2);
    expect(read.rows[2][0]).toBe('Marta Soler');
  });

  test('a huge row number or column reference makes nothing grow', () => {
    const xml = '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="ZZZZZZZ1"><v>1</v></c></row><row r="999999999"><c r="A999999999"><v>2</v></c></row></sheetData>';
    const rows = sheetRows(xml, []);
    expect(rows).toEqual([['a']]);
    expect(sheetRows('<row r="1"/><row r="2"/><row r="3"/>', [], 2)).toHaveLength(2);
    expect(columnIndex('ABCD1')).toBe(-1);
  });

  test('an entry bigger than the cap once inflated is refused', async () => {
    const buf = storedZip({ 'a.txt': 'x'.repeat(100) });
    const entry = zipEntries(buf)[0];
    await expect(zipRead(buf, entry, 50)).rejects.toThrow('too large');
    expect((await zipRead(buf, entry, 100)).length).toBe(100);
  });

  test('a zip that is not a workbook says so', async () => {
    await expect(readXlsx(storedZip({ 'a.txt': 'x' }))).rejects.toThrow('not a workbook');
  });
});
