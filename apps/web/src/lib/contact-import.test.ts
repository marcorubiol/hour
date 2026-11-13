import { describe, expect, test } from 'vitest';
import {
  addBatchResult,
  assignColumn,
  batches,
  columnLetter,
  decodeText,
  EMPTY_RESULT,
  excelDate,
  failedAsTsv,
  fieldForHeader,
  kindFromText,
  lookupRequest,
  mappingReady,
  mergeRows,
  payloadRows,
  planContacts,
  proposeColumns,
  readRows,
  sheetFromCells,
  sheetFromText,
  tallyPlan,
  undoDaysLeft,
  type ImportField,
  type ImportLookup,
} from './contact-import';

// Una compañía ficticia, Cía. Paraguas; correos de example.org.
const CSV = [
  'Nombre;Organización;Cargo;Email;Tel.;Ciudad;Tipo;Últ. contacto;Zona;Col J',
  'Marta Soler;Sala Farola;Programación;marta@example.org;+34 600 000 101;Tarragona;teatro;14/03/2025;Catalunya;ok',
  'Jordi Pons;Teatro Bastidor;Dirección artística;;977 000 202;Huesca;sala;mar 2024;Aragón;',
  ';Ayuntamiento de Ejemplo;;cultura@example.org;;Lleida;ayto.;;Catalunya;',
  ';;;;977 000 999;;;;;',
  'Irene Nadal;;;IRENE@example.org;;Lleida;;;;',
  'Irene Nadal;Festival Lunar;Programadora;irene@example.org;600 000 303;;festival;02/05/2025;;',
  'Pau Ferrer;Red Ficticia;;pau@example;;;mezcla;;;',
].join('\n');

const sheet = sheetFromText(CSV);
const mapping = proposeColumns(sheet);

describe('reading the sheet', () => {
  test('CSV with semicolons, and a paste from the sheet (tabs), read alike', () => {
    expect(sheet.header[0]).toBe('Nombre');
    expect(sheet.rows).toHaveLength(7);
    const tsv = sheetFromText('Nombre\tEmail\nMarta Soler\tmarta@example.org\n\n');
    expect(tsv).toEqual({ header: ['Nombre', 'Email'], rows: [['Marta Soler', 'marta@example.org']] });
  });

  test('blank rows go, short rows are padded, a header without a name takes its letter', () => {
    const s = sheetFromCells([[], ['Nombre', '', 'Email'], ['', '', ''], ['Ana']]);
    expect(s.header).toEqual(['Nombre', 'Col. B', 'Email']);
    expect(s.rows).toEqual([['Ana', '', '']]);
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(26)).toBe('AA');
  });

  test('text that is not UTF-8 is read as Windows-1252', () => {
    expect(decodeText(new Uint8Array([0x4e, 0x61, 0x64, 0x61, 0x6c, 0x20, 0xe9]))).toBe('Nadal é');
    expect(decodeText(new TextEncoder().encode('Nadal é'))).toBe('Nadal é');
  });
});

describe('columns', () => {
  test('headers propose fields in four languages; the rest goes to the note or is skipped', () => {
    expect(mapping).toEqual<ImportField[]>([
      'person_name',
      'org_name',
      'title',
      'email',
      'phone',
      'city',
      'org_kind',
      'last_contact',
      'note',
      'note',
    ]);
    expect(fieldForHeader('Correu electrònic')).toBe('email');
    expect(fieldForHeader('Téléphone')).toBe('phone');
    expect(fieldForHeader('Nom de famille')).toBe('last_name');
    expect(fieldForHeader('Zona')).toBeNull();
    expect(proposeColumns(sheetFromText('Nombre,Vacía\nAna,'))).toEqual(['person_name', 'skip']);
  });

  test('a second column naming the same field goes to the note', () => {
    expect(proposeColumns(sheetFromText('Email,Mail\na@example.org,b@example.org'))).toEqual(['email', 'note']);
  });

  test('choosing a field another column held moves that one to the note', () => {
    expect(assignColumn(['email', 'note', 'skip'], 1, 'email')).toEqual(['note', 'email', 'skip']);
    expect(assignColumn(['note', 'note'], 1, 'note')).toEqual(['note', 'note']);
  });

  test('a name or an email is needed to go on', () => {
    expect(mappingReady(['note', 'skip'])).toBe(false);
    expect(mappingReady(['note', 'email'])).toBe(true);
    expect(mappingReady(['org_name'])).toBe(true);
  });
});

describe('rows', () => {
  const rows = readRows(sheet, mapping);

  test('a person with an organization: contact fields are the person’s, the rest to the note', () => {
    expect(rows[0]).toMatchObject({
      line: 2,
      person: { full_name: 'Marta Soler', title: 'Programación', email: 'marta@example.org', phone: '+34 600 000 101', city: 'Tarragona' },
      org: { name: 'Sala Farola', kind: 'theatre' },
      error: null,
    });
    expect(rows[0].note).toEqual(['Últ. contacto: 14/03/2025', 'Zona: Catalunya', 'Col J: ok']);
  });

  test('an organization alone keeps its own email and city, and its note goes to the organization', () => {
    expect(rows[2]).toMatchObject({
      person: null,
      org: { name: 'Ayuntamiento de Ejemplo', email: 'cultura@example.org', city: 'Lleida' },
      error: null,
    });
    expect(rows[2].rawKind).toBeUndefined();
    // «ayto.» se lee: es una institución; el texto con punto se limpia.
    expect(rows[2].org?.kind).toBe('institution');
    expect(rows[2].issues).toContain('note_to_organization');
  });

  test('without a name nor an organization the row does not go in', () => {
    expect(rows[3]).toMatchObject({ line: 5, error: 'no_name' });
  });

  test('a bad email does not stop the row: it goes in without it, and the note keeps it', () => {
    expect(rows[6].person?.email).toBeUndefined();
    expect(rows[6].issues).toEqual(expect.arrayContaining(['bad_email', 'kind_unread']));
    expect(rows[6].note).toEqual(expect.arrayContaining(['Email: pau@example', 'Tipo: mezcla']));
  });

  test('first and last name make the name when there is no full name', () => {
    const s = sheetFromText('Nombre de pila,Apellidos\nAna,Ruiz Gil');
    expect(readRows(s, proposeColumns(s))[0].person).toEqual({ full_name: 'Ana Ruiz Gil', first_name: 'Ana', last_name: 'Ruiz Gil' });
  });

  test('what does not fit its field goes whole to the note', () => {
    const s = sheetFromText(`Nombre,Teléfono\nAna,${'1'.repeat(70)}`);
    const r = readRows(s, proposeColumns(s))[0];
    expect(r.person?.phone).toBeUndefined();
    expect(r.note[0]).toMatch(/^Teléfono: 1{70}$/);
    const long = sheetFromText(`Nombre\n${'a'.repeat(201)}`);
    expect(readRows(long, proposeColumns(long))[0].error).toBe('too_long');
  });

  test('kinds read in the four languages; Excel dates read as day/month/year', () => {
    expect(kindFromText('Théâtre')).toBe('theatre');
    expect(kindFromText('Festival')).toBe('festival');
    expect(kindFromText('Ajuntament')).toBe('institution');
    expect(kindFromText('cosa rara')).toBeNull();
    expect(excelDate('45730')).toBe('14/03/2025');
    expect(excelDate('mar 2024')).toBe('mar 2024');
    expect(excelDate('600')).toBe('600');
  });
});

describe('repeated in the sheet', () => {
  const merged = mergeRows(readRows(sheet, mapping), 'Organización');

  test('same email is one contact: fields add up, notes join, lines are kept', () => {
    const irene = merged.find((c) => c.person?.full_name === 'Irene Nadal')!;
    expect(irene.lines).toEqual([6, 7]);
    expect(irene.person).toMatchObject({ email: 'irene@example.org', city: 'Lleida', title: 'Programadora', phone: '600 000 303' });
    expect(irene.org?.name).toBe('Festival Lunar');
    expect(merged).toHaveLength(6);
  });

  test('a second organization for the same person is said and goes to the note', () => {
    const s = sheetFromText('Nombre,Email,Organización\nAna,ana@example.org,Sala A\nAna,ana@example.org,Sala B');
    const [ana] = mergeRows(readRows(s, proposeColumns(s)), 'Organización');
    expect(ana.org?.name).toBe('Sala A');
    expect(ana.issues).toContain('other_org');
    expect(ana.note).toContain('Organización: Sala B');
  });

  test('rows that do not go in are never merged', () => {
    const s = sheetFromText('Nombre,Teléfono\n,1\n,2');
    expect(mergeRows(readRows(s, proposeColumns(s)))).toHaveLength(2);
  });
});

describe('against Hour', () => {
  const merged = mergeRows(readRows(sheet, mapping), 'Organización');
  const lookup: ImportLookup = {
    persons: [
      {
        person_id: '00000000-0000-4000-8000-000000000001',
        full_name: 'Marta Soler',
        email: 'marta@example.org',
        phone: null,
        title: 'Programación',
        city: 'Tarragona',
        country: null,
        website: null,
        organization_id: '00000000-0000-4000-8000-0000000000a1',
        organization_name: 'Sala Farola',
      },
      {
        person_id: '00000000-0000-4000-8000-000000000002',
        full_name: 'Jordi Pons',
        email: null,
        phone: null,
        title: null,
        city: null,
        country: null,
        website: null,
        organization_id: '00000000-0000-4000-8000-0000000000a2',
        organization_name: 'Teatro Bastidor',
      },
      {
        person_id: '00000000-0000-4000-8000-000000000003',
        full_name: 'Pau Ferrer',
        email: null,
        phone: null,
        title: null,
        city: null,
        country: null,
        website: null,
        organization_id: null,
        organization_name: null,
      },
    ],
    organizations: [
      { id: '00000000-0000-4000-8000-0000000000a1', name: 'Sala Farola', kind: 'other', email: null, phone: null, city: null, country: null, website: null },
    ],
  };
  const plan = planContacts(merged, lookup);
  const by = (name: string) => plan.find((c) => (c.person?.full_name ?? c.org?.name) === name)!;

  test('asks Hour for the emails, names and organizations of the sheet', () => {
    const req = lookupRequest(merged);
    expect(req.emails).toEqual(expect.arrayContaining(['marta@example.org', 'irene@example.org']));
    expect(req.organizations).toContain('Ayuntamiento de Ejemplo');
    expect(req.names).not.toContain('');
  });

  test('same email: the same person, and only the empty fields are filled', () => {
    expect(by('Marta Soler')).toMatchObject({ status: 'fill', personFills: ['phone'], orgFills: ['kind'] });
  });

  test('same name without the email: asked; «the same» proposed in the same organization', () => {
    expect(by('Jordi Pons')).toMatchObject({ status: 'ask', proposal: 'same' });
    expect(by('Pau Ferrer')).toMatchObject({ status: 'ask', proposal: 'other' });
  });

  test('new people and organizations, and the rows that do not go in', () => {
    expect(by('Irene Nadal').status).toBe('new');
    expect(by('Ayuntamiento de Ejemplo').status).toBe('new');
    const t = tallyPlan(plan);
    expect(t).toMatchObject({ rows: 7, merged: 1, errors: 1, ask: 2, fills: 1, toImport: 5 });
    // Irene y Pau (la propuesta dice «otra persona»); Jordi es «la misma».
    expect(t.newPersons).toBe(2);
    // Teatro Bastidor, Ayuntamiento, Festival Lunar, Red Ficticia.
    expect(t.newOrgs).toBe(4);
    expect(tallyPlan(plan, { 3: 'other' }).newPersons).toBe(3);
  });

  test('the payload carries the decision, and the note of an organization alone travels too', () => {
    const rows = payloadRows(plan, { 8: 'same' });
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.line === 3)?.person?.match_person_id).toBe('00000000-0000-4000-8000-000000000002');
    expect(rows.find((r) => r.line === 8)?.person?.match_person_id).toBe('00000000-0000-4000-8000-000000000003');
    expect(rows.find((r) => r.line === 2)?.note).toBe('Últ. contacto: 14/03/2025\nZona: Catalunya\nCol J: ok');
    expect(rows.find((r) => r.line === 4)?.note).toBe('Zona: Catalunya');
    expect(payloadRows(plan).find((r) => r.line === 8)?.person?.match_person_id).toBeUndefined();
  });
});

describe('batches, results and undo', () => {
  test('2.000 rows go in ten batches of 200', () => {
    const b = batches(Array.from({ length: 2000 }, (_, i) => i));
    expect(b.map((x) => x.length)).toEqual(Array(10).fill(200));
    expect(batches([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  test('batch results add up', () => {
    const one = { ...EMPTY_RESULT, import_id: 'i', persons_created: 2, failed: [{ line: 5, reason: 'no_name' as const }] };
    const total = addBatchResult(addBatchResult(EMPTY_RESULT, one), { ...one, import_id: null, persons_created: 1, failed: [] });
    expect(total).toMatchObject({ import_id: 'i', persons_created: 3, failed: [{ line: 5, reason: 'no_name' }] });
  });

  test('the rows that did not go in, as a sheet to fix', () => {
    expect(failedAsTsv(sheet, [5, 5])).toBe(`${sheet.header.join('\t')}\n\t\t\t\t977 000 999\t\t\t\t\t`);
  });

  test('seven days to undo, none once undone', () => {
    const now = Date.parse('2026-11-13T12:00:00Z');
    expect(undoDaysLeft({ created_at: '2026-11-13T11:00:00Z', status: 'done' }, now)).toBe(7);
    expect(undoDaysLeft({ created_at: '2026-11-06T13:00:00Z', status: 'done' }, now)).toBe(1);
    expect(undoDaysLeft({ created_at: '2026-11-06T11:00:00Z', status: 'done' }, now)).toBe(0);
    expect(undoDaysLeft({ created_at: '2026-11-13T11:00:00Z', status: 'undone' }, now)).toBe(0);
  });
});
