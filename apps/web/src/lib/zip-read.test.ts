import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { chatFromZip, zipEntries, ZipError } from './zip-read';

/** Un zip mínimo, como el del teléfono: cada archivo guardado (0) o comprimido (8). */
function makeZip(files: { name: string; data: string; method: 0 | 8 }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = enc.encode(f.data);
    const body = f.method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const local = new Uint8Array(30 + name.length + body.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, f.method, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(body, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, f.method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

const CHAT = '[13/3/24, 18:02:15] Elena Kosmos: Os confirmo el 14 ñ\n';

describe('chatFromZip', () => {
  it('reads the iPhone _chat.txt, deflated, and lists the attachments', async () => {
    const zip = makeZip([
      { name: '00000012-PHOTO-2024-03-13-18-41-03.jpg', data: 'jpg', method: 0 },
      { name: '_chat.txt', data: CHAT, method: 8 },
    ]);
    const out = await chatFromZip(zip);
    expect(out.text).toBe(CHAT);
    expect(out.files).toEqual(['00000012-PHOTO-2024-03-13-18-41-03.jpg']);
  });

  it('reads the Android .txt, stored', async () => {
    const zip = makeZip([{ name: 'WhatsApp Chat with Elena Kosmos.txt', data: CHAT, method: 0 }]);
    expect((await chatFromZip(zip)).name).toBe('WhatsApp Chat with Elena Kosmos.txt');
  });

  it('skips macOS resource forks', async () => {
    const zip = makeZip([
      { name: '__MACOSX/._chat.txt', data: 'x', method: 0 },
      { name: '_chat.txt', data: CHAT, method: 0 },
    ]);
    expect((await chatFromZip(zip)).text).toBe(CHAT);
  });

  it('a zip without a chat, or not a zip, says so', async () => {
    await expect(chatFromZip(makeZip([{ name: 'a.jpg', data: 'x', method: 0 }]))).rejects.toBeInstanceOf(ZipError);
    expect(() => zipEntries(new TextEncoder().encode('hola, no soy un zip'))).toThrow(ZipError);
  });
});
