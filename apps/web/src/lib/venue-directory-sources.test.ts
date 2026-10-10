import { describe, expect, it } from 'vitest';
import { normPlace } from './places';
import { kindFromName, sameVenueByName } from './venue-directory';
import {
  eielId,
  eielRecords,
  eielVerdict,
  frenchRegion,
  idemMadridRecords,
  municipalityName,
  spanishProvinceZone,
  spanishRegion,
} from './venue-directory-sources';

describe('Spanish provinces: region and zone, never guessed', () => {
  it('maps a province to its community', () => {
    expect(spanishRegion('04')).toBe('Andalucía');
    expect(spanishRegion('46')).toBe('Comunitat Valenciana');
    expect(spanishRegion('28')).toBe('Comunidad de Madrid');
    expect(spanishRegion('99')).toBeNull();
  });
  it('the Canaries and Ceuta/Melilla have their own zone', () => {
    expect(spanishProvinceZone('41')).toBe('Europe/Madrid');
    expect(spanishProvinceZone('38')).toBe('Atlantic/Canary');
    expect(spanishProvinceZone('52')).toBe('Africa/Ceuta');
    expect(spanishProvinceZone('99')).toBeNull();
  });
});

describe('municipalityName', () => {
  it('puts the article in front and keeps the first official name', () => {
    expect(municipalityName('Campello, el')).toBe('el Campello');
    expect(municipalityName("Orxa, l'/Lorcha")).toBe("l'Orxa");
    expect(municipalityName('Elx/Elche')).toBe('Elx');
    expect(municipalityName('Montesinos, Los')).toBe('Los Montesinos');
    expect(municipalityName('Rinconada (La)')).toBe('La Rinconada');
    expect(municipalityName('Abla')).toBe('Abla');
    expect(municipalityName('')).toBeNull();
  });
});

describe('frenchRegion', () => {
  it('metropolitan regions by admin1, overseas by territory', () => {
    expect(frenchRegion('FR', '11')).toBe('Île-de-France');
    expect(frenchRegion('FR', '93')).toBe("Provence-Alpes-Côte d'Azur");
    expect(frenchRegion('RE', null)).toBe('La Réunion');
    expect(frenchRegion('FR', '00')).toBeNull();
  });
});

describe('eielVerdict: the phase 1 kinds, no civic centre without capacity', () => {
  const v = (type: string, uses: string[], name: string, state = 'B') =>
    eielVerdict(type, new Set(uses), normPlace(name), state, kindFromName);
  it('teatro/cine is a stage, a cinema alone is not', () => {
    expect(v('TC', [], 'TEATRO SAAVEDRA')).toEqual({ kind: 'theatre', designation: 'Teatro/cine' });
    expect(v('TC', [], 'CENTRO CULTURAL DE ADRA')).toMatchObject({ kind: 'theatre' });
    expect(v('TC', ['CI'], 'CINE DE VERANO')).toEqual({ skip: 'cine sin uso escénico' });
    expect(v('TC', ['TE'], 'CINE MUNICIPAL')).toMatchObject({ kind: 'theatre' });
    expect(v('TC', [], 'CINE TEATRO REGIO')).toMatchObject({ kind: 'theatre' });
  });
  it('auditorio, casa de cultura, otros with a stage use', () => {
    expect(v('AU', [], 'AUDITORIO ADOLFO SUAREZ')).toMatchObject({ kind: 'auditorium' });
    expect(v('CC', [], 'CASA DE LA CULTURA')).toMatchObject({ kind: 'cultural_centre' });
    expect(v('OT', ['AO'], 'NAVE POLIVALENTE')).toMatchObject({ kind: 'multipurpose' });
    expect(v('OT', ['MO'], 'CASTILLO')).toBeNull();
  });
  it('a social or civic centre never enters (no declared capacity)', () => {
    expect(v('CS', ['TE'], 'USOS MULTIPLES')).toEqual({ skip: 'centro social con escenario, sin aforo' });
    expect(v('CS', [], 'CLUB 3 EDAD')).toBeNull();
  });
  it('libraries, museums and buildings under construction stay out', () => {
    expect(v('BI', ['TE'], 'BIBLIOTECA')).toBeNull();
    expect(v('MS', [], 'MUSEO')).toBeNull();
    expect(v('TC', [], 'TEATRO', 'E')).toEqual({ skip: 'en ejecución' });
  });
});

describe('eielRecords: one province of the national survey', () => {
  const centres = [
    '2024|CU|04|001|0001|01|001|CENTRO CULTURAL ABULENSE|CC|MU|MU|1101|0|367|SI|B',
    '2024|CU|04|001|0001|01|002|CLUB 3ª EDAD|CS|MU|MU|276|0|138|NO|B',
    '2024|CU|04|031|0001|01|004|TEATRO SAAVEDRA|TC|MU|MU|500|0|500|SI|R',
    '2024|CU|04|031|0001|01|005|USOS MULTIPLES|CS|MU|MU|500|0|500|SI|R',
  ].join('\r\n');
  const uses = ['2024|CU|04|031|0001|01|004|TE|300', '2024|CU|04|031|0001|01|005|TE|200'].join('\r\n');
  const municipalities = ['2024|04|001||Abla', '2024|04|031||Ejido, El'].join('\r\n');
  const skipped: string[] = [];
  const recs = eielRecords({ centres, uses, municipalities }, normPlace, kindFromName, (w) => skipped.push(w));
  it('keeps the casa de cultura and the theatre, with a stable id', () => {
    expect(recs.map((r) => [r.source_id, r.name, r.kind, r.city])).toEqual([
      ['04001-0001-01-001', 'CENTRO CULTURAL ABULENSE', 'cultural_centre', 'Abla'],
      ['04031-0001-01-004', 'TEATRO SAAVEDRA', 'theatre', 'El Ejido'],
    ]);
    expect(eielId('04', '031', '0001', '01', '004')).toBe('04031-0001-01-004');
  });
  it('no coordinates, no contacts; region and zone from the province', () => {
    expect(recs[1]).toMatchObject({
      source: 'eiel', country: 'ES', region: 'Andalucía', timezone: 'Europe/Madrid',
      lat: null, lon: null, email: null, phone: null, website: null, capacity: null,
    });
  });
  it('says why the social centre with a stage stayed out', () => {
    expect(skipped).toEqual(['centro social con escenario, sin aforo']);
  });
});

describe('idemMadridRecords: the Comunidad de Madrid EIEL, with coordinates', () => {
  const feature = (p: Record<string, string | null>, lon = -3.86, lat = 40.72) => ({
    geometry: { coordinates: [lon, lat] },
    properties: { PROV: '28', MUN: '082', ENT: '0001', POBLAMIENT: '01', ORDEN_CENT: '003', MUNICIPIO: 'Manzanares el Real', ...p },
  });
  const skipped: string[] = [];
  const recs = idemMadridRecords(
    {
      features: [
        feature({ NOMBRE: 'TEATRO MUNICIPAL', TIPO: 'TEATRO/CINE', TEATRO: 'SI', ESTADO: 'BUENO' }),
        feature({ NOMBRE: 'CENTRO CIVICO', TIPO: 'CENTRO CIVICO/SOCIAL', TEATRO: 'SI', ESTADO: 'BUENO' }),
        feature({ NOMBRE: 'CASTILLO', TIPO: 'MUSEO', ESTADO: 'BUENO' }),
        feature({ NOMBRE: 'AUDITORIO NUEVO', TIPO: 'AUDITORIO', ESTADO: 'EN EJECUCION' }),
      ],
    },
    normPlace,
    kindFromName,
    (w) => skipped.push(w),
  );
  it('keeps the theatre with its point and the EIEL id', () => {
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      source: 'madrid_eiel', source_id: '28082-0001-01-003', kind: 'theatre', city: 'Manzanares el Real',
      region: 'Comunidad de Madrid', lat: 40.72, lon: -3.86,
    });
  });
  it('drops the civic centre and the building under construction, with reasons', () => {
    expect(skipped).toEqual(['centro social con escenario, sin aforo', 'en ejecución']);
  });
});

describe('sameVenueByName: the merge without coordinates is strict', () => {
  const at = (name: string, city: string, qid: string | null = null) => ({
    norm: normPlace(name),
    city: normPlace(city),
    lat: null,
    lon: null,
    qid,
  });
  it('same town, same distinctive name', () => {
    expect(sameVenueByName(at('Teatro Saavedra', 'El Ejido'), at('TEATRO SAAVEDRA', 'El Ejido'))?.by).toBe('city_name');
    expect(sameVenueByName(at('Teatro Echegaray', 'Ronda'), at('Teatro Echegaray de Ronda', 'Ronda'))?.by).toBe('city_name');
  });
  it('generic names never merge on the name alone', () => {
    expect(sameVenueByName(at('Teatro Municipal', 'Adra'), at('Teatro Municipal de Adra', 'Adra'))).toBeNull();
    expect(sameVenueByName(at('Casa de la Cultura', 'Abla'), at('Casa de la Cultura', 'Abla'))).toBeNull();
  });
  it('another town or another name is another venue', () => {
    expect(sameVenueByName(at('Teatro Saavedra', 'Adra'), at('Teatro Saavedra', 'Abla'))).toBeNull();
    expect(sameVenueByName(at('Teatro Saavedra', 'Adra'), at('Teatro Cervantes', 'Adra'))).toBeNull();
    expect(sameVenueByName(at('Teatro Saavedra', ''), at('Teatro Saavedra', ''))).toBeNull();
  });
});
