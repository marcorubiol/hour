/**
 * Lo mínimo para abrir el .zip de «Exportar chat» en el navegador (ADR-189):
 * listar sus archivos y sacar el texto del chat. Sin librería: el directorio
 * central del zip y `DecompressionStream('deflate-raw')`, que traen los
 * navegadores y Node. Sólo «guardado» (0) y «deflate» (8); sin cifrado ni
 * zip64, que el teléfono no usa para esto.
 */

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** Dónde empieza su cabecera local. */
  offset: number;
}

export class ZipError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Las entradas del directorio central. */
export function zipEntries(buf: Uint8Array): ZipEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // El final del directorio está en los últimos 22 bytes más el comentario (hasta 64 KB).
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError('not a zip');
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || view.getUint32(p, true) !== CENTRAL) throw new ZipError('broken central directory');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    if (!(flags & 1)) out.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Los bytes de una entrada. */
export async function zipRead(buf: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const p = entry.offset;
  if (view.getUint32(p, true) !== LOCAL) throw new ZipError('broken local header');
  const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new ZipError(`unsupported method ${entry.method}`);
}

/**
 * El texto del chat dentro del zip: `_chat.txt` (iPhone) o el único .txt
 * («WhatsApp Chat with…», Android). Con él, los nombres de los adjuntos.
 */
export async function chatFromZip(buf: Uint8Array): Promise<{ text: string; name: string; files: string[] }> {
  const entries = zipEntries(buf).filter((e) => !e.name.endsWith('/') && !/(^|\/)(__MACOSX|\._)/.test(e.name));
  const txt = entries.filter((e) => /\.txt$/i.test(e.name));
  const chat = txt.find((e) => /(^|\/)_chat\.txt$/i.test(e.name)) ?? txt.find((e) => /whatsapp/i.test(e.name)) ?? txt[0];
  if (!chat) throw new ZipError('no chat in zip');
  const text = new TextDecoder().decode(await zipRead(buf, chat));
  return { text, name: chat.name, files: entries.filter((e) => e !== chat).map((e) => e.name.replace(/^.*\//, '')) };
}
