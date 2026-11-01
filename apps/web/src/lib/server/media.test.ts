import { describe, expect, test } from 'vitest';
import { MEDIA_LIMITS, publicMediaKey, putPublicImage, rejectImage, sniffImage } from './media';

const WS = '20000000-0000-4000-8000-000000000001';

/** Una cabecera PNG mínima: firma, IHDR con ancho y alto. */
function png(width: number, height: number, pad = 0): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(33 + pad);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

/** Un JPEG mínimo: SOI, un APP0 y un SOF0 con alto y ancho. */
function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
}

describe('sniffImage', () => {
  test('PNG y JPEG por sus bytes, con su tamaño', () => {
    expect(sniffImage(png(480, 120))).toEqual({ mime: 'image/png', ext: 'png', width: 480, height: 120 });
    expect(sniffImage(jpeg(1200, 800))).toEqual({ mime: 'image/jpeg', ext: 'jpg', width: 1200, height: 800 });
  });

  test('lo demás no es imagen: SVG, GIF, texto', () => {
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('GIF89a......................'))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});

describe('rejectImage', () => {
  test('tope de peso y de lado por uso', () => {
    expect(rejectImage(png(480, 120), 'logo')).toBeNull();
    expect(rejectImage(png(480, 120, MEDIA_LIMITS.logo.bytes), 'logo')).toBe('too_large');
    expect(rejectImage(png(4000, 100), 'logo')).toBe('too_big_side');
    expect(rejectImage(jpeg(2400, 1600), 'mail')).toBeNull();
    expect(rejectImage(new Uint8Array(10), 'mail')).toBe('unsupported');
  });
});

describe('rutas públicas', () => {
  test('solo una imagen de un espacio con el nombre que da la subida; nunca otra clave', () => {
    const good = `ws/${WS}/logo/${'a'.repeat(32)}-480x120.png`;
    expect(publicMediaKey(good)).toBe(`public/${good}`);
    expect(publicMediaKey(`ws/${WS}/mail/${'a'.repeat(32)}-1200x800.jpg`)).not.toBeNull();
    expect(publicMediaKey('places/v1/index.json')).toBeNull();
    expect(publicMediaKey(`ws/${WS}/logo/../../places/v1/index.json`)).toBeNull();
    expect(publicMediaKey(`ws/${WS}/other/${'a'.repeat(32)}-1x1.png`)).toBeNull();
    expect(publicMediaKey(`ws/${WS}/logo/${'a'.repeat(32)}-1x1.svg`)).toBeNull();
  });

  test('la subida guarda bajo public/ con hash y tamaño, y la ruta que devuelve la sirve /m/', async () => {
    const put: { key: string; type?: string }[] = [];
    const bucket = {
      put: async (key: string, _body: unknown, opts?: { httpMetadata?: { contentType?: string } }) => {
        put.push({ key, type: opts?.httpMetadata?.contentType });
        return null;
      },
    } as unknown as R2Bucket;
    const path = await putPublicImage(bucket, WS.toUpperCase(), 'logo', png(480, 120));
    expect(path).toMatch(new RegExp(`^/m/ws/${WS}/logo/[0-9a-f]{32}-480x120\\.png$`));
    expect(put).toEqual([{ key: `public${path.slice(2)}`, type: 'image/png' }]);
    expect(publicMediaKey(path.slice(3))).toBe(put[0].key);
    // La misma imagen, la misma ruta.
    expect(await putPublicImage(bucket, WS, 'logo', png(480, 120))).toBe(path);
  });
});
