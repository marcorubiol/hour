import { describe, expect, it } from 'vitest';
import { normPlace } from './places';
import {
  directoryQueryWords,
  genericEmail,
  kindFromName,
  landlinePhone,
  nameLikeness,
  sameVenue,
  tidyName,
  websiteUrl,
} from './venue-directory';

describe('genericEmail: only a role of the venue, never a person', () => {
  it('keeps role addresses', () => {
    expect(genericEmail('info@angles.cat')).toBe('info@angles.cat');
    expect(genericEmail('Teatre@Bescano.cat')).toBe('teatre@bescano.cat');
    expect(genericEmail('cultura.ajuntament@x.cat')).toBe('cultura.ajuntament@x.cat');
    expect(genericEmail('taquilla2@teatre.cat')).toBe('taquilla2@teatre.cat');
  });
  it('drops anything that may be a person or is doubtful', () => {
    expect(genericEmail('jsoler@lesplanes.cat')).toBeNull();
    expect(genericEmail('simonflotats@hotmail.com')).toBeNull();
    expect(genericEmail('lesquirol@diba.cat')).toBeNull();
    expect(genericEmail('toni.info@x.cat')).toBeNull();
    expect(genericEmail('not an email')).toBeNull();
    expect(genericEmail(null)).toBeNull();
  });
  it('reads the first address of a list', () => {
    expect(genericEmail('info@a.cat; jroyo@a.cat')).toBe('info@a.cat');
    expect(genericEmail('aperezg@a.com; info@a.com')).toBeNull();
  });
});

describe('landlinePhone: landlines only', () => {
  it('Spain: 8/9 nine digits, prefix and separators stripped', () => {
    expect(landlinePhone('933198050', 'ES')).toBe('933198050');
    expect(landlinePhone('+34 920-354015', 'ES')).toBe('920354015');
    expect(landlinePhone('693818303', 'ES')).toBeNull();
    expect(landlinePhone('712345678', 'ES')).toBeNull();
  });
  it('France: 01-05 and 09, never 06/07', () => {
    expect(landlinePhone('01 42 74 22 77', 'FR')).toBe('0142742277');
    expect(landlinePhone('+33 6 12 34 56 78', 'FR')).toBeNull();
  });
  it('unknown country: nothing', () => {
    expect(landlinePhone('933198050', 'IT')).toBeNull();
  });
});

describe('websiteUrl', () => {
  it('adds the scheme and refuses what is not a host', () => {
    expect(websiteUrl('www.teatre.cat')).toBe('https://www.teatre.cat/');
    expect(websiteUrl('http://x.org/a')).toBe('http://x.org/a');
    expect(websiteUrl('NA')).toBeNull();
    expect(websiteUrl('')).toBeNull();
  });
});

describe('tidyName', () => {
  it('title-cases names typed in capitals, Catalan elisions included', () => {
    expect(tidyName("CASAL DE CULTURA D'OLOT")).toBe("Casal de Cultura d'Olot");
    expect(tidyName("L'ATENEU")).toBe("L'Ateneu");
    expect(tidyName('CENTRE  CÍVIC')).toBe('Centre Cívic');
  });
  it('leaves a name with lower case exactly as written', () => {
    expect(tidyName('Théâtre du Gymnase-Bernardines')).toBe('Théâtre du Gymnase-Bernardines');
  });
});

describe('nameLikeness: generic words do not make two venues one', () => {
  const like = (a: string, b: string) => nameLikeness(normPlace(a), normPlace(b));
  it('the shorter name inside the longer is 1', () => {
    expect(like('Teatre Principal', "Teatre Principal d'Olot")).toBe(1);
    expect(like('Ateneu Barcelonès', "Teatre de l'Ateneu Barcelonès")).toBe(1);
  });
  it('«Teatre Arnau» and «Teatre Apolo» share nothing that counts', () => {
    expect(like('Teatre Arnau', 'Teatre Apolo')).toBe(0);
  });
  it('a name of only generic words compares by those words', () => {
    expect(like('Casa de Cultura', 'Casa de la Cultura')).toBe(1);
  });
});

describe('sameVenue', () => {
  const at = (name: string, city: string, lat: number, lon: number, qid: string | null = null) => ({
    norm: normPlace(name),
    city: normPlace(city),
    lat,
    lon,
    qid,
  });
  it('the same QID is the same venue, a different one never is', () => {
    expect(sameVenue(at('A', 'x', 41, 2, 'Q1'), at('B', 'y', 42, 3, 'Q1'))?.by).toBe('qid');
    expect(sameVenue(at('Teatre Goya', 'bcn', 41, 2, 'Q1'), at('Teatre Goya', 'bcn', 41, 2, 'Q2'))).toBeNull();
  });
  it('two labels of one house a few metres apart', () => {
    const m = sameVenue(at('Teatre Goya', 'Barcelona', 41.3784, 2.1631), at('Goya', 'Barcelona', 41.37842, 2.16312));
    expect(m?.by).toBe('same_spot');
  });
  it('two theatres next door stay two', () => {
    expect(sameVenue(at('Teatre Arnau', 'Barcelona', 41.3736, 2.1685), at('Teatre Apolo', 'Barcelona', 41.3739, 2.1690))).toBeNull();
  });
  it('the town in the name does not count', () => {
    expect(
      sameVenue(at('Teatre Barcelona', 'Barcelona', 41.38, 2.17), at('La Off Barcelona', 'Barcelona', 41.3801, 2.1701)),
    ).toBeNull();
  });
  it('same name word for word in the same town, under 1 km', () => {
    const m = sameVenue(
      at('Teatre Municipal (Banyoles)', 'Banyoles', 42.119, 2.766),
      at('Teatre Municipal de Banyoles', 'Banyoles', 42.1155, 2.7695),
    );
    expect(m?.by).toBe('city_name');
  });
  it('no coordinates, no merge', () => {
    expect(sameVenue({ ...at('A', 'x', 0, 0), lat: null, lon: null }, at('A', 'x', 0, 0))).toBeNull();
  });
});

describe('kindFromName and the search words', () => {
  it('reads the kind from the name, theatre first', () => {
    expect(kindFromName(normPlace('Teatro Auditorio de Ponferrada'))).toBe('theatre');
    expect(kindFromName(normPlace('Auditorio Municipal'))).toBe('auditorium');
    expect(kindFromName(normPlace('Casa de Cultura'))).toBe('cultural_centre');
    expect(kindFromName(normPlace('Espacio Polivalente La Almazara'))).toBe('multipurpose');
    expect(kindFromName(normPlace('Antiguas Escuelas'))).toBe('other_stage');
  });
  it('splits the text into at most six distinct words, nothing under two letters', () => {
    expect(directoryQueryWords(normPlace('Teatre  Girona teatre'))).toEqual(['teatre', 'girona']);
    expect(directoryQueryWords('a')).toEqual([]);
  });
});
