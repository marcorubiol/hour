import { describe, expect, test } from 'vitest';
import type { GmailRawMessage } from './gmail';
import {
  attachmentDisposition,
  attachmentPart,
  base64UrlBytes,
  parseGmailOriginal,
  safeMimeType,
} from './original';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const utf8 = (s: string) => b64url(new TextEncoder().encode(s));

const plain = 'Nos encaja el 12.\n\nEl lun, 3 nov 2026, Marco escribió:\n> ¿Os va bien el 12?';
const html = '<html><head><style>p{color:red}</style></head><body><p>Nos encaja el <b>12</b>.</p><blockquote>¿Os va bien?</blockquote></body></html>';

const message: GmailRawMessage = {
  id: 'm1',
  threadId: 't1',
  internalDate: String(Date.parse('2026-11-03T10:00:00Z')),
  payload: {
    partId: '',
    mimeType: 'multipart/mixed',
    headers: [
      { name: 'From', value: '=?UTF-8?B?QW5vdWsgTcO8bGxlcg==?= <anouk@sala.example>' },
      { name: 'To', value: 'marco@muk.example' },
      { name: 'Cc', value: 'tecnica@sala.example' },
      { name: 'Subject', value: 'Re: Fecha' },
      { name: 'Message-ID', value: '<a@sala.example>' },
    ],
    parts: [
      {
        partId: '0',
        mimeType: 'multipart/alternative',
        parts: [
          {
            partId: '0.0',
            mimeType: 'text/plain',
            headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }],
            body: { data: utf8(plain), size: plain.length },
          },
          {
            partId: '0.1',
            mimeType: 'text/html',
            headers: [{ name: 'Content-Type', value: 'text/html; charset=UTF-8' }],
            body: { data: utf8(html), size: html.length },
          },
        ],
      },
      {
        partId: '1',
        mimeType: 'application/pdf',
        filename: 'rider técnico.pdf',
        headers: [{ name: 'Content-Disposition', value: 'attachment; filename="rider técnico.pdf"' }],
        body: { attachmentId: 'ANGjdJ', size: 48213 },
      },
      {
        partId: '2',
        mimeType: 'image/png',
        filename: 'logo.png',
        headers: [
          { name: 'Content-Disposition', value: 'inline; filename="logo.png"' },
          { name: 'Content-ID', value: '<logo@sala>' },
        ],
        body: { attachmentId: 'BBB', size: 900 },
      },
    ],
  },
};

describe('the original of a mail (111)', () => {
  test('keeps everything the sync trims: the quote, the HTML, the attachments', () => {
    const o = parseGmailOriginal(message);
    expect(o.text).toBe(plain);
    expect(o.text).toContain('> ¿Os va bien el 12?');
    expect(o.html).toBe(html);
    expect(o.from).toBe('Anouk Müller <anouk@sala.example>');
    expect(o.to).toBe('marco@muk.example');
    expect(o.cc).toBe('tecnica@sala.example');
    expect(o.subject).toBe('Re: Fecha');
    expect(o.date).toBe('2026-11-03T10:00:00.000Z');
    expect(o.truncated).toBe(false);
    expect(o.attachments).toEqual([
      { part_id: '1', filename: 'rider técnico.pdf', mime_type: 'application/pdf', size: 48213, inline: false },
      { part_id: '2', filename: 'logo.png', mime_type: 'image/png', size: 900, inline: true },
    ]);
  });

  test('decodes a part in its own charset', () => {
    const latin1 = Uint8Array.from([0x63, 0x61, 0x6e, 0x63, 0x69, 0xf3, 0x6e]); // «canción» in ISO-8859-1
    const o = parseGmailOriginal({
      id: 'm2',
      payload: {
        partId: '',
        mimeType: 'text/plain',
        headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }],
        body: { data: b64url(latin1) },
      },
    });
    expect(o.text).toBe('canción');
    expect(o.html).toBeNull();
    expect(o.attachments).toEqual([]);
  });

  test('a text part with a filename is an attachment, not the body', () => {
    const o = parseGmailOriginal({
      id: 'm3',
      payload: {
        partId: '',
        mimeType: 'multipart/mixed',
        parts: [
          { partId: '0', mimeType: 'text/plain', body: { data: utf8('Hola') } },
          { partId: '1', mimeType: 'text/plain', filename: 'notas.txt', body: { data: utf8('adjunto'), size: 7 } },
        ],
      },
    });
    expect(o.text).toBe('Hola');
    expect(o.attachments.map((a) => a.part_id)).toEqual(['1']);
  });

  test('finds an attachment only by the partId of an attachment', () => {
    expect(attachmentPart(message, '1')?.body?.attachmentId).toBe('ANGjdJ');
    expect(attachmentPart(message, '0.1')).toBeNull(); // the HTML body is not downloadable as an attachment
    expect(attachmentPart(message, '9')).toBeNull();
  });

  test('base64url bytes round-trip', () => {
    const bytes = Uint8Array.from([0, 255, 128, 62, 63]);
    expect([...base64UrlBytes(b64url(bytes))]).toEqual([...bytes]);
  });

  test('a download never trusts the mail for its headers', () => {
    expect(safeMimeType('application/pdf')).toBe('application/pdf');
    expect(safeMimeType('text/html\r\nSet-Cookie: x=1')).toBe('application/octet-stream');
    expect(safeMimeType(undefined)).toBe('application/octet-stream');
    const d = attachmentDisposition('ri"der\r\n/../técnico.pdf');
    expect(d).not.toMatch(/[\r\n]/);
    expect(d).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
    expect(d).toContain("filename*=UTF-8''ri_der_.._t%C3%A9cnico.pdf");
    expect(attachmentDisposition('')).toContain('filename="adjunto"');
  });
});
