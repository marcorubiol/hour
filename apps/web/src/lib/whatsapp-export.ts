/**
 * Lee el «Exportar chat» de WhatsApp (tarea 128, ADR-189): el .txt que sale
 * del teléfono, solo o dentro del .zip con los adjuntos.
 *
 * iPhone y Android escriben distinto, y cada uno según el idioma y la región
 * del teléfono:
 *   iPhone   `[4/11/26, 18:02:15] Elena: texto` (con marcas invisibles U+200E)
 *   Android  `4/11/26, 18:02 - Elena: texto`
 *   12 horas `11/4/26, 6:02 p. m. - …` o `[11/4/26, 6:02:15 PM] …` (a veces con
 *            el espacio estrecho U+202F antes de la marca)
 * Una línea sin cabecera sigue el mensaje anterior (multilínea). Lo que no
 * tiene autor, o el aviso con marca invisible delante en el iPhone, es del
 * sistema (cifrado, alguien entró, cambió el asunto, mensaje eliminado) y no
 * entra.
 *
 * El export no trae zona horaria: la hora es la del teléfono, y aquí se deja
 * como hora local (`YYYY-MM-DDTHH:MM:SS`); quien importa la convierte con la
 * del dispositivo. Día/mes o mes/día se deduce del archivo entero: un primer
 * campo mayor que 12 lo decide; si nada lo decide, el orden que deja las
 * fechas en orden y el último mensaje más cerca de hoy (`bestAmbiguousOrder`;
 * la pista del navegador sólo desempata), y la pantalla deja cambiarlo.
 *
 * Puro: ni red ni DOM. Los tests van con muestras inventadas por formato.
 */

export type DateOrder = 'dmy' | 'mdy' | 'ymd';
export type ExportPlatform = 'ios' | 'android';
export type AttachmentType = 'photo' | 'video' | 'audio' | 'sticker' | 'gif' | 'document' | 'contact' | 'location' | 'file';

export interface ExportAttachment {
  type: AttachmentType;
  /** El nombre del archivo; null si el export lo omitió («imagen omitida»). */
  name: string | null;
}

export interface ExportMessage {
  /** Hora local del teléfono, sin zona: `YYYY-MM-DDTHH:MM:SS`. */
  local: string;
  /** Si el export traía segundos (iPhone) o sólo minutos (Android). */
  seconds: boolean;
  /** El nombre como lo tiene en la agenda quien exportó, o el número. */
  author: string;
  /** El texto, sin las marcas de adjunto ni «editado». Puede quedar vacío si sólo era un adjunto. */
  body: string;
  attachments: ExportAttachment[];
  edited: boolean;
}

export interface ParsedExport {
  platform: ExportPlatform;
  order: DateOrder;
  /** Ninguna fecha decidió el orden: se tomó la pista. */
  ambiguous: boolean;
  messages: ExportMessage[];
  /** Avisos del sistema descartados. */
  system: number;
  /** Autores en orden de aparición. */
  authors: string[];
  /** Un grupo: más de dos autores o un aviso de grupo. */
  group: boolean;
}

/** Marcas invisibles de dirección que WhatsApp mete en el texto. */
const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g;
/** Espacios raros (estrecho, duro) que separan la hora de «PM». */
const ODD_SPACE = /[   ]/g;

// [d/m/y, h:mm(:ss)( PM)] rest    o    d/m/y, h:mm( p. m.) - rest
const HEAD =
  /^\[?(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\s*([aApP])\.?\s?[mM]\.?)?(\]\s*|\s+-\s+)([\s\S]*)$/;

interface RawLine {
  a: number;
  b: number;
  c: number;
  h: number;
  mi: number;
  s: number | null;
  ampm: 'a' | 'p' | null;
  ios: boolean;
  rest: string;
  /** El resto empezaba por una marca invisible (en el iPhone, un aviso del sistema o un adjunto). */
  marked: boolean;
}

function readHead(line: string): RawLine | null {
  const clean = line.replace(ODD_SPACE, ' ');
  const lead = clean.replace(/^[‎‏﻿]+/, '');
  const m = HEAD.exec(lead);
  if (!m) return null;
  const rest = m[9];
  return {
    a: Number(m[1]),
    b: Number(m[2]),
    c: Number(m[3]),
    h: Number(m[4]),
    mi: Number(m[5]),
    s: m[6] === undefined ? null : Number(m[6]),
    ampm: m[7] ? (m[7].toLowerCase() as 'a' | 'p') : null,
    ios: m[8].startsWith(']'),
    rest,
    marked: /^[‎‏]/.test(rest),
  };
}

/** El orden de los campos de fecha, leyendo todas las cabeceras. */
export function detectOrder(heads: Pick<RawLine, 'a' | 'b'>[], hint: DateOrder = 'dmy'): { order: DateOrder; ambiguous: boolean } {
  if (heads.some((x) => x.a > 31)) return { order: 'ymd', ambiguous: false };
  if (heads.some((x) => x.a > 12)) return { order: 'dmy', ambiguous: false };
  if (heads.some((x) => x.b > 12)) return { order: 'mdy', ambiguous: false };
  return { order: hint === 'ymd' ? 'dmy' : hint, ambiguous: heads.length > 0 };
}

/**
 * Con un archivo que no decide (todas las fechas con día y mes ≤ 12), el
 * orden que mejor encaja: el que deja las fechas en orden (un chat no va
 * hacia atrás) y, si los dos lo hacen, el que no acaba en el futuro y deja el
 * último mensaje más cerca de hoy (un chat se exporta cuando se usa). Sólo si
 * nada de eso decide, la pista del navegador: el formato del export sigue la
 * región del teléfono, no la del navegador.
 */
export function bestAmbiguousOrder(heads: RawLineDate[], hint: DateOrder, today: Date): DateOrder {
  const score = (order: DateOrder) => {
    const days = heads.map((h) => toLocal({ ...h, h: 12, mi: 0, s: 0, ampm: null }, order)?.slice(0, 10) ?? null);
    if (days.some((d) => d === null)) return { ok: false, back: Infinity, future: true, gap: Infinity };
    let back = 0;
    for (let i = 1; i < days.length; i++) if (days[i]! < days[i - 1]!) back += 1;
    const last = Date.parse(`${days[days.length - 1]}T12:00:00Z`);
    const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 12);
    return { ok: true, back, future: last > now + 86_400_000, gap: Math.abs(now - last) };
  };
  const a = score('dmy');
  const b = score('mdy');
  if (a.ok !== b.ok) return a.ok ? 'dmy' : 'mdy';
  if (a.back !== b.back) return a.back < b.back ? 'dmy' : 'mdy';
  if (a.future !== b.future) return a.future ? 'mdy' : 'dmy';
  if (a.gap !== b.gap) return a.gap < b.gap ? 'dmy' : 'mdy';
  return hint === 'mdy' ? 'mdy' : 'dmy';
}

type RawLineDate = Pick<RawLine, 'a' | 'b' | 'c'>;

/** La pista del orden por el idioma del navegador: mes primero sólo donde se escribe así. */
export function orderHint(locale: string | undefined): DateOrder {
  return /^en-(US|PH|CA)\b/i.test(locale ?? '') ? 'mdy' : 'dmy';
}

const pad = (n: number) => String(n).padStart(2, '0');

function toLocal(x: Pick<RawLine, 'a' | 'b' | 'c' | 'h' | 'mi' | 's' | 'ampm'>, order: DateOrder): string | null {
  let d: number, mo: number, y: number;
  if (order === 'ymd') [y, mo, d] = [x.a, x.b, x.c];
  else if (order === 'mdy') [mo, d, y] = [x.a, x.b, x.c];
  else [d, mo, y] = [x.a, x.b, x.c];
  if (y < 100) y += 2000;
  let h = x.h;
  if (x.ampm) h = (h % 12) + (x.ampm === 'p' ? 12 : 0);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || x.mi > 59) return null;
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(x.mi)}:${pad(x.s ?? 0)}`;
}

/** El tipo de un adjunto por su nombre (los dos teléfonos lo nombran distinto). */
export function attachmentType(name: string): AttachmentType {
  const n = name.toLowerCase();
  if (/sticker|\.webp$/.test(n)) return 'sticker';
  if (/gif/.test(n)) return 'gif';
  if (/photo|^img-|\.(jpe?g|png|heic|heif)$/.test(n)) return 'photo';
  if (/video|^vid-|\.(mp4|mov|3gp|m4v)$/.test(n)) return 'video';
  if (/audio|^ptt-|^aud-|\.(opus|m4a|mp3|aac|ogg|wav)$/.test(n)) return 'audio';
  if (/\.vcf$/.test(n)) return 'contact';
  if (/\.(pdf|docx?|xlsx?|pptx?|pages|numbers|key|txt|odt|rtf|csv)$/.test(n)) return 'document';
  return 'file';
}

/** iPhone con archivos: `<adjunto: 00000012-PHOTO-….jpg>` (es, en, ca, fr, pt, it, de). */
const IOS_ATTACHED = /^<(?:adjunto|attached|adjunt|pièce jointe|anexado|anexo|allegato|Anhang|angehängt)\s*:\s*([^>]+)>$/i;
/** Android con archivos: `IMG-20261104-WA0003.jpg (archivo adjunto)`. */
const ANDROID_ATTACHED =
  /^(.+?\.[A-Za-z0-9]{2,5})\s+\((?:archivo adjunto|file attached|fitxer adjunt|fichier joint|arquivo anexado|file allegato|Datei angehängt)\)$/i;
/** Sin archivos: «imagen omitida», «<Multimedia omitido>», «image omitted»… */
const OMITTED = /^(?:(.*\S)\s+)?<?([\p{L}]+)\s+(?:omitid[oa]s?|omitted|omès|omesa|omis|omise|omitido|omessi?|omesso|weggelassen)\s*>?$/iu;

const OMITTED_WORD: Record<string, AttachmentType> = {
  imagen: 'photo', image: 'photo', imatge: 'photo', imagem: 'photo', immagine: 'photo', bild: 'photo', foto: 'photo',
  video: 'video', vídeo: 'video', vidéo: 'video',
  audio: 'audio', àudio: 'audio', áudio: 'audio',
  sticker: 'sticker', autocollant: 'sticker', adhesiu: 'sticker', figurinha: 'sticker',
  gif: 'gif',
  documento: 'document', document: 'document', dokument: 'document',
  tarjeta: 'contact', contacto: 'contact', 'contact card': 'contact',
  multimedia: 'file', media: 'file', multimèdia: 'file', médias: 'file', mídia: 'file', medien: 'file',
};

/** «Se editó este mensaje.» al final, en los idiomas que más salen. */
const EDITED = /\s*<(?:Se editó este mensaje\.?|This message was edited|S'ha editat aquest missatge\.?|Ce message a été modifié|Mensagem editada|Messaggio modificato|Diese Nachricht wurde bearbeitet)>\s*$/i;

/** Avisos del sistema que el export escribe con autor (los de grupo y los borrados). */
const SYSTEM_TEXT =
  /^(?:Los mensajes y las llamadas están cifrados|Messages and calls are end-to-end encrypted|Els missatges i les trucades|Les messages et les appels|Se eliminó este mensaje|Eliminaste este mensaje|This message was deleted|You deleted this message|S'ha suprimit aquest missatge|Ce message a été supprimé|Mensaje eliminado|Llamada perdida|Missed (?:voice|video) call|Videollamada perdida|null$)/i;
/** Lo que delata un grupo en un aviso. */
const GROUP_SIGN =
  /(?:creó el grupo|created group|ha creat el grup|a créé le groupe|añadió a|te añadió|added|ha afegit|a ajouté|cambió el asunto|changed the subject|ha canviat l'assumpte|a modifié le sujet|salió del grupo|left$|ha sortit|est parti|cambió la descripción del grupo|changed the group)/i;

function readBody(raw: string): { body: string; attachments: ExportAttachment[]; edited: boolean } {
  let text = raw.replace(BIDI, '');
  let edited = false;
  if (EDITED.test(text)) {
    edited = true;
    text = text.replace(EDITED, '');
  }
  const attachments: ExportAttachment[] = [];
  const lines = text.split('\n');
  const first = lines[0].trim();
  let m: RegExpExecArray | null;
  if ((m = IOS_ATTACHED.exec(first)) || (m = ANDROID_ATTACHED.exec(first))) {
    const name = m[1].trim();
    attachments.push({ type: attachmentType(name), name });
    lines.shift();
  } else if ((m = OMITTED.exec(first))) {
    const word = m[2].toLowerCase();
    const type = OMITTED_WORD[word];
    if (type) {
      // iPhone: «Rider.pdf • 3 páginas documento omitido»: el nombre va delante.
      const before = (m[1] ?? '').replace(/\s*•.*$/, '').trim();
      attachments.push({ type: before && type === 'document' ? attachmentType(before) : type, name: before || null });
      lines.shift();
    }
  }
  return { body: lines.join('\n').trim(), attachments, edited };
}

/**
 * Lee el texto entero de un export. `hint`: el orden de fecha que se toma si
 * ninguna fecha lo decide; `order`: forzarlo (la pantalla deja cambiarlo).
 */
export function parseWhatsAppExport(
  text: string,
  opts: { hint?: DateOrder; order?: DateOrder; today?: Date } = {},
): ParsedExport {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const entries: { head: RawLine; extra: string[] }[] = [];
  for (const line of lines) {
    const head = readHead(line);
    if (head) entries.push({ head, extra: [] });
    else if (entries.length > 0) entries[entries.length - 1].extra.push(line);
    // Lo de antes de la primera cabecera (no debería haber nada) se ignora.
  }

  const detected = detectOrder(
    entries.map((e) => e.head),
    opts.hint,
  );
  const order =
    opts.order ??
    (detected.ambiguous ? bestAmbiguousOrder(entries.map((e) => e.head), opts.hint ?? 'dmy', opts.today ?? new Date()) : detected.order);
  const ios = entries.filter((e) => e.head.ios).length >= entries.length / 2;

  const messages: ExportMessage[] = [];
  const authors: string[] = [];
  let system = 0;
  let groupSign = false;

  for (const { head, extra } of entries) {
    const local = toLocal(head, order);
    const full = [head.rest, ...extra].join('\n');
    const colon = full.indexOf(': ');
    // Sin «autor: », un aviso del sistema (Android); con él, el autor puede
    // ser el nombre del grupo y el aviso ir marcado (iPhone).
    if (colon <= 0 || local === null) {
      system += 1;
      if (GROUP_SIGN.test(full.replace(BIDI, ''))) groupSign = true;
      continue;
    }
    const author = full.slice(0, colon).replace(BIDI, '').trim();
    const rawBody = full.slice(colon + 2);
    const marked = /^[‎‏]/.test(rawBody);
    const { body, attachments, edited } = readBody(rawBody);
    const plain = rawBody.replace(BIDI, '').trim();
    if (!author || SYSTEM_TEXT.test(plain) || (marked && attachments.length === 0 && !edited)) {
      system += 1;
      if (GROUP_SIGN.test(plain)) groupSign = true;
      continue;
    }
    if (!body && attachments.length === 0) {
      system += 1;
      continue;
    }
    if (!authors.includes(author)) authors.push(author);
    messages.push({ local, seconds: head.s !== null, author, body, attachments, edited });
  }

  return {
    platform: ios ? 'ios' : 'android',
    order,
    ambiguous: opts.order ? false : detected.ambiguous,
    messages,
    system,
    authors,
    group: authors.length > 2 || groupSign,
  };
}

/**
 * El título del chat por el nombre del archivo: «Chat de WhatsApp con Elena
 * Ruiz.zip», «WhatsApp Chat - Elena Ruiz.zip», «WhatsApp Chat with Elena
 * Ruiz.txt»… El `_chat.txt` del zip del iPhone no dice nada: null.
 */
export function chatTitleFromFilename(filename: string): string | null {
  const base = filename.replace(/^.*[\\/]/, '').replace(/\.(zip|txt)$/i, '').trim();
  const m =
    /^(?:Chat de WhatsApp con|WhatsApp Chat with|WhatsApp Chat -|WhatsApp Chat|Xat de WhatsApp amb|Discussion WhatsApp avec|Conversa do WhatsApp com|Chat WhatsApp con|WhatsApp-Chat mit)\s+(.+)$/i.exec(base);
  if (m) return m[1].trim() || null;
  if (/^_?chat$/i.test(base)) return null;
  return base || null;
}

/** El nombre de un adjunto como lo dice la pantalla: «Foto», «Audio», «PDF»… (clave de i18n). */
export function attachmentKey(type: AttachmentType): string {
  return `wa_import.att_${type}`;
}
