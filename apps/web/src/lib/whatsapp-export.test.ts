import { describe, expect, it } from 'vitest';
import { attachmentType, chatTitleFromFilename, detectOrder, orderHint, parseWhatsAppExport } from './whatsapp-export';

// Muestras inventadas: personas, salas y textos de ficción, con la forma exacta
// de cada teléfono (marcas U+200E, espacio estrecho U+202F, «p. m.»).
const LRM = '‎';
const NNBSP = ' ';

const IOS_ES = [
  `[12/3/24, 9:15:02] Elena Kosmos: ${LRM}Los mensajes y las llamadas están cifrados de extremo a extremo. Nadie fuera de este chat puede leerlos.`,
  '[12/3/24, 9:15:02] Elena Kosmos: Hola Marco, soy Elena de la Sala Kosmos',
  '[12/3/24, 9:16:40] Marco: ¡Hola Elena! Encantado',
  '[13/3/24, 18:02:15] Elena Kosmos: Os confirmo el 14 a las 20 h.',
  '¿Llegáis el mismo día?',
  '',
  'Un abrazo',
  `[13/3/24, 18:41:03] Elena Kosmos: ${LRM}<adjunto: 00000012-PHOTO-2024-03-13-18-41-03.jpg>`,
  `[13/3/24, 18:42:10] Marco: ${LRM}imagen omitida`,
  `[13/3/24, 18:43:00] Marco: Montaje desde las 10 ${LRM}<Se editó este mensaje.>`,
  `[13/3/24, 18:44:00] Elena Kosmos: ${LRM}Se eliminó este mensaje.`,
  `[13/3/24, 18:45:00] Elena Kosmos: ${LRM}Rider técnico.pdf • 3 páginas ${LRM}documento omitido`,
].join('\n');

const ANDROID_ES = [
  '13/03/24, 18:00 - Los mensajes y las llamadas están cifrados de extremo a extremo. Nadie fuera de este chat, ni siquiera WhatsApp, puede leerlos ni escucharlos.',
  '13/03/24, 18:02 - Elena Kosmos: Os confirmo el 14 a las 20 h.',
  '13/03/24, 18:41 - Elena Kosmos: IMG-20240313-WA0003.jpg (archivo adjunto)',
  'Así queda el escenario',
  '13/03/24, 18:42 - Marco: <Multimedia omitido>',
  '13/03/24, 18:43 - Marco: PTT-20240313-WA0004.opus (archivo adjunto)',
  '14/03/24, 9:05 - +34 600 11 22 33: Soy Jordi, el técnico',
].join('\n');

const IOS_EN_US = [
  `[3/13/24, 6:02:15${NNBSP}PM] Elena Kosmos: Confirmed for the 14th`,
  `[3/13/24, 12:05:00${NNBSP}AM] Marco: Late night ok`,
  `[3/13/24, 12:30:00${NNBSP}PM] Marco: ${LRM}<attached: 00000013-AUDIO-2024-03-13-12-30-00.opus>`,
].join('\n');

const ANDROID_ES_12H = [
  `13/3/24, 6:02${NNBSP}p.${NNBSP}m. - Elena Kosmos: Confirmado`,
  `13/3/24, 11:59${NNBSP}a.${NNBSP}m. - Marco: Perfecto`,
].join('\n');

const GROUP_ANDROID = [
  '28/10/26, 10:00 - Marco creó el grupo "Girona 14N"',
  '28/10/26, 10:00 - Marco añadió a Jordi Sala',
  '28/10/26, 10:01 - Marco: Grupo para el bolo de Girona',
  '28/10/26, 10:05 - Jordi Sala: Recibido. Os paso planos',
  '28/10/26, 10:06 - Ana Luz: Yo llevo las luces',
].join('\n');

describe('parseWhatsAppExport, iPhone en castellano', () => {
  const p = parseWhatsAppExport(IOS_ES);

  it('reads the platform and the order from the dates', () => {
    expect(p.platform).toBe('ios');
    expect(p.order).toBe('dmy');
    expect(p.ambiguous).toBe(false);
  });

  it('drops the encryption notice and the deleted message', () => {
    expect(p.messages.some((m) => /cifrados/.test(m.body))).toBe(false);
    expect(p.messages.some((m) => /eliminó/.test(m.body))).toBe(false);
    expect(p.system).toBe(2);
  });

  it('joins a multi-line message, blank lines included', () => {
    const m = p.messages.find((x) => x.body.startsWith('Os confirmo'))!;
    expect(m.body).toBe('Os confirmo el 14 a las 20 h.\n¿Llegáis el mismo día?\n\nUn abrazo');
    expect(m.local).toBe('2024-03-13T18:02:15');
    expect(m.seconds).toBe(true);
  });

  it('reads attachments: attached, omitted, a document by its name', () => {
    const photo = p.messages.find((x) => x.local.endsWith('18:41:03'))!;
    expect(photo.attachments).toEqual([{ type: 'photo', name: '00000012-PHOTO-2024-03-13-18-41-03.jpg' }]);
    expect(photo.body).toBe('');
    const omitted = p.messages.find((x) => x.local.endsWith('18:42:10'))!;
    expect(omitted.attachments).toEqual([{ type: 'photo', name: null }]);
    const doc = p.messages.find((x) => x.local.endsWith('18:45:00'))!;
    expect(doc.attachments).toEqual([{ type: 'document', name: 'Rider técnico.pdf' }]);
  });

  it('strips the edited mark and keeps it as a flag', () => {
    const m = p.messages.find((x) => x.local.endsWith('18:43:00'))!;
    expect(m.body).toBe('Montaje desde las 10');
    expect(m.edited).toBe(true);
  });

  it('lists the authors and sees a direct chat', () => {
    expect(p.authors).toEqual(['Elena Kosmos', 'Marco']);
    expect(p.group).toBe(false);
  });
});

describe('parseWhatsAppExport, Android en castellano', () => {
  const p = parseWhatsAppExport(ANDROID_ES);

  it('reads minutes only, and the platform', () => {
    expect(p.platform).toBe('android');
    expect(p.messages[0].local).toBe('2024-03-13T18:02:00');
    expect(p.messages[0].seconds).toBe(false);
  });

  it('keeps the caption under an attached file', () => {
    const m = p.messages.find((x) => x.attachments[0]?.name === 'IMG-20240313-WA0003.jpg')!;
    expect(m.attachments[0].type).toBe('photo');
    expect(m.body).toBe('Así queda el escenario');
  });

  it('reads an omitted media and a voice note', () => {
    expect(p.messages.find((x) => x.local.endsWith('18:42:00'))!.attachments).toEqual([{ type: 'file', name: null }]);
    expect(p.messages.find((x) => x.local.endsWith('18:43:00'))!.attachments[0].type).toBe('audio');
  });

  it('keeps an unsaved number as the author, and counts three authors as a group', () => {
    expect(p.authors).toContain('+34 600 11 22 33');
    expect(p.group).toBe(true);
  });

  it('a line without author is a system notice', () => {
    expect(p.system).toBe(1);
  });
});

describe('parseWhatsAppExport, 12 horas', () => {
  it('iPhone in US English: month first, PM, midnight is 00', () => {
    const p = parseWhatsAppExport(IOS_EN_US);
    expect(p.order).toBe('mdy');
    expect(p.messages.map((m) => m.local)).toEqual(['2024-03-13T18:02:15', '2024-03-13T00:05:00', '2024-03-13T12:30:00']);
    expect(p.messages[2].attachments[0].type).toBe('audio');
  });

  it('Android in Spanish with «p. m.» and narrow spaces', () => {
    const p = parseWhatsAppExport(ANDROID_ES_12H);
    expect(p.messages.map((m) => m.local)).toEqual(['2024-03-13T18:02:00', '2024-03-13T11:59:00']);
  });
});

describe('parseWhatsAppExport, grupo', () => {
  it('sees the group by its notices and drops them', () => {
    const p = parseWhatsAppExport(GROUP_ANDROID);
    expect(p.group).toBe(true);
    expect(p.system).toBe(2);
    expect(p.messages).toHaveLength(3);
  });

  it('a two-person chat with a group notice is still a group', () => {
    const p = parseWhatsAppExport(GROUP_ANDROID.split('\n').slice(0, 4).join('\n'));
    expect(p.authors).toHaveLength(2);
    expect(p.group).toBe(true);
  });
});

describe('date order', () => {
  it('a first field over 12 decides day first; a second over 12, month first', () => {
    expect(detectOrder([{ a: 3, b: 4 }, { a: 13, b: 4 }])).toEqual({ order: 'dmy', ambiguous: false });
    expect(detectOrder([{ a: 3, b: 14 }])).toEqual({ order: 'mdy', ambiguous: false });
    expect(detectOrder([{ a: 2026, b: 11 }])).toEqual({ order: 'ymd', ambiguous: false });
  });

  it('nothing decides: the hint, flagged as ambiguous', () => {
    expect(detectOrder([{ a: 3, b: 4 }], 'mdy')).toEqual({ order: 'mdy', ambiguous: true });
    const p = parseWhatsAppExport('[3/4/26, 10:00:00] Elena: hola', { hint: 'dmy' });
    expect(p.ambiguous).toBe(true);
    expect(p.messages[0].local).toBe('2026-04-03T10:00:00');
  });

  it('a forced order wins', () => {
    const p = parseWhatsAppExport('[3/4/26, 10:00:00] Elena: hola', { order: 'mdy' });
    expect(p.messages[0].local).toBe('2026-03-04T10:00:00');
    expect(p.ambiguous).toBe(false);
  });

  it('the hint follows the browser language', () => {
    expect(orderHint('en-US')).toBe('mdy');
    expect(orderHint('es-ES')).toBe('dmy');
    expect(orderHint('en-GB')).toBe('dmy');
    expect(orderHint(undefined)).toBe('dmy');
  });

  it('dotted dates and four-digit years', () => {
    const p = parseWhatsAppExport('[13.03.2024, 18:02:15] Elena: hola');
    expect(p.messages[0].local).toBe('2024-03-13T18:02:15');
  });
});

describe('robustness', () => {
  it('Windows line ends and a BOM', () => {
    const p = parseWhatsAppExport('﻿13/03/24, 18:02 - Elena: uno\r\ndos\r\n13/03/24, 18:03 - Marco: tres');
    expect(p.messages.map((m) => m.body)).toEqual(['uno\ndos', 'tres']);
  });

  it('a colon inside the text stays in the text', () => {
    const p = parseWhatsAppExport('13/03/24, 18:02 - Elena: Horario: 20:00 h');
    expect(p.messages[0]).toMatchObject({ author: 'Elena', body: 'Horario: 20:00 h' });
  });

  it('empty input', () => {
    const p = parseWhatsAppExport('');
    expect(p.messages).toEqual([]);
    expect(p.ambiguous).toBe(false);
  });
});

describe('chatTitleFromFilename', () => {
  it('reads the name out of each phone and language', () => {
    expect(chatTitleFromFilename('Chat de WhatsApp con Elena Kosmos.zip')).toBe('Elena Kosmos');
    expect(chatTitleFromFilename('WhatsApp Chat - Girona 14N.zip')).toBe('Girona 14N');
    expect(chatTitleFromFilename('WhatsApp Chat with Elena Kosmos.txt')).toBe('Elena Kosmos');
    expect(chatTitleFromFilename('Xat de WhatsApp amb Jordi.txt')).toBe('Jordi');
    expect(chatTitleFromFilename('_chat.txt')).toBeNull();
  });
});

describe('attachmentType', () => {
  it('by the name each phone writes', () => {
    expect(attachmentType('00000012-PHOTO-2024-03-13.jpg')).toBe('photo');
    expect(attachmentType('VID-20240313-WA0001.mp4')).toBe('video');
    expect(attachmentType('PTT-20240313-WA0004.opus')).toBe('audio');
    expect(attachmentType('STK-20240313-WA0005.webp')).toBe('sticker');
    expect(attachmentType('Rider.pdf')).toBe('document');
    expect(attachmentType('Elena.vcf')).toBe('contact');
    expect(attachmentType('cosa.bin')).toBe('file');
  });
});
