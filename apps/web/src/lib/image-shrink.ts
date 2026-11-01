/**
 * Reducir una imagen en el navegador antes de subirla (ADR-172): un correo
 * pesa poco, y un Worker no redimensiona. Sale PNG o JPEG, los que lee
 * cualquier cliente de correo; la entrada puede ser cualquier imagen que el
 * navegador sepa abrir (también WebP o HEIC en Safari).
 */

interface ShrinkOptions {
  /** Lado máximo del fichero, en px de imagen (el doble de lo que pinta el correo). */
  maxWidth: number;
  maxHeight: number;
  /** PNG guarda la transparencia (el logo); JPEG pesa menos (la foto). */
  type: 'image/png' | 'image/jpeg';
  /** Por encima de esto, se repite en JPEG (sobre blanco) y con menos calidad. */
  maxBytes: number;
}

/** El tamaño de destino: dentro de la caja, sin agrandar nunca. */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), type, quality),
  );
}

export async function shrinkImage(file: Blob, opts: ShrinkOptions): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const size = fitWithin(bitmap.width, bitmap.height, opts.maxWidth, opts.maxHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('canvas_unavailable');
  const draw = (background: boolean) => {
    g.clearRect(0, 0, size.width, size.height);
    if (background) {
      g.fillStyle = 'white';
      g.fillRect(0, 0, size.width, size.height);
    }
    g.drawImage(bitmap, 0, 0, size.width, size.height);
  };
  draw(opts.type === 'image/jpeg');
  let blob = await encode(canvas, opts.type, opts.type === 'image/jpeg' ? 0.82 : undefined);
  for (const quality of [0.82, 0.7, 0.6]) {
    if (blob.size <= opts.maxBytes) break;
    draw(true);
    blob = await encode(canvas, 'image/jpeg', quality);
  }
  bitmap.close();
  return blob;
}
