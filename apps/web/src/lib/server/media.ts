/**
 * Imágenes públicas de un espacio en R2 (ADR-172): el logo de la compañía y la
 * imagen del espectáculo de un envío. Es el primer fichero que Hour sube a
 * `MEDIA` (hasta hoy solo guardaba el nomenclátor de lugares).
 *
 * Solo lo que tiene que verse desde un correo, y por eso público: todo vive
 * bajo `public/ws/<espacio>/<uso>/` y lo sirve `/m/…` sin sesión. El resto del
 * bucket sigue sin servirse. El nombre es el hash del contenido y su tamaño
 * (`<sha>-<ancho>x<alto>.<ext>`): la URL no cambia mientras la imagen no
 * cambie, se puede cachear para siempre, y la plantilla del correo sabe el
 * tamaño sin leer la imagen.
 *
 * Solo PNG y JPEG (los que lee cualquier cliente de correo; ni WebP ni SVG),
 * reconocidos por sus bytes, no por lo que diga el navegador. La pantalla
 * reduce la imagen antes de subirla; aquí se pone el tope.
 */

export type MediaUse = 'logo' | 'mail';

/** Tope de peso y de lado por uso: un correo pesa poco. */
export const MEDIA_LIMITS: Record<MediaUse, { bytes: number; side: number }> = {
  logo: { bytes: 200_000, side: 1200 },
  mail: { bytes: 600_000, side: 2400 },
};

export interface SniffedImage {
  mime: 'image/png' | 'image/jpeg';
  ext: 'png' | 'jpg';
  width: number;
  height: number;
}

/** PNG o JPEG por sus bytes, con su tamaño; null si no es ninguno. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  // PNG: firma de 8 bytes y el IHDR primero (ancho y alto big-endian).
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width && height ? { mime: 'image/png', ext: 'png', width, height } : null;
  }
  // JPEG: SOI y los segmentos hasta el primer SOF (que lleva alto y ancho).
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6];
        const width = (bytes[i + 7] << 8) | bytes[i + 8];
        return width && height ? { mime: 'image/jpeg', ext: 'jpg', width, height } : null;
      }
      if (length < 2) return null;
      i += 2 + length;
    }
  }
  return null;
}

/** Por qué no se acepta una imagen; null si vale. */
export function rejectImage(bytes: Uint8Array, use: MediaUse): 'too_large' | 'unsupported' | 'too_big_side' | null {
  if (bytes.byteLength > MEDIA_LIMITS[use].bytes) return 'too_large';
  const img = sniffImage(bytes);
  if (!img) return 'unsupported';
  if (Math.max(img.width, img.height) > MEDIA_LIMITS[use].side) return 'too_big_side';
  return null;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Lo que `/m/` sirve: una imagen de un espacio, con el nombre que da `putPublicImage`. */
export const PUBLIC_MEDIA_RE = new RegExp(`^ws/${UUID}/(logo|mail)/[0-9a-f]{32}-\\d{1,5}x\\d{1,5}\\.(png|jpg)$`);

/** La clave en R2 de una ruta pública (`ws/…` → `public/ws/…`). */
export function publicMediaKey(path: string): string | null {
  return PUBLIC_MEDIA_RE.test(path) ? `public/${path}` : null;
}

async function sha(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Guarda una imagen ya validada y devuelve su ruta de la app
 * (`/m/ws/<espacio>/<uso>/<sha>-<w>x<h>.<ext>`). La misma imagen da la misma
 * ruta: subirla dos veces no duplica nada.
 */
export async function putPublicImage(
  bucket: R2Bucket,
  workspaceId: string,
  use: MediaUse,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const img = sniffImage(bytes);
  if (!img) throw new Error('not an image');
  const path = `ws/${workspaceId.toLowerCase()}/${use}/${await sha(bytes)}-${img.width}x${img.height}.${img.ext}`;
  await bucket.put(`public/${path}`, bytes, {
    httpMetadata: { contentType: img.mime, cacheControl: 'public, max-age=31536000, immutable' },
  });
  return `/m/${path}`;
}

/** El cuerpo de una subida (la imagen tal cual, sin multipart), con el tope del uso. */
export async function readUpload(request: Request, use: MediaUse): Promise<Uint8Array<ArrayBuffer> | 'too_large'> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MEDIA_LIMITS[use].bytes) return 'too_large';
  const bytes = new Uint8Array(await request.arrayBuffer());
  return bytes.byteLength > MEDIA_LIMITS[use].bytes ? 'too_large' : bytes;
}
