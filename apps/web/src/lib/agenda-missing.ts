/**
 * ONE AMBER IN THE AGENDA (ADR-236, amends ADR-211 § 3): of every performance
 * the Agenda draws, only the first thing that falls due is named, in amber,
 * with when; every other open thing is a figure in grey, «N por cerrar».
 */
export interface OpenItem {
  text: string;
  urgent: boolean;
  /** The day it falls due: a hold's decide-by day, else the performance's. */
  due: string;
}
export interface FirstDue {
  id: string;
  text: string;
  due: string;
}
export interface AgendaWord {
  text: string;
  urgent: boolean;
  /** The grey dashed dot of «por cerrar» (styles/missing.css). */
  dot?: boolean;
}

/** The urgent item that falls due first, of all the rows; ties keep the first row. */
export function firstDue(rows: readonly { id: string; items: readonly OpenItem[] }[]): FirstDue | null {
  let best: FirstDue | null = null;
  for (const r of rows) {
    for (const it of r.items) {
      if (it.urgent && (!best || it.due < best.due)) best = { id: r.id, text: it.text, due: it.due };
    }
  }
  return best;
}

/** Whole days from `today` to `day` (both YYYY-MM-DD). */
export function daysTo(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** The words of one row: the amber one if it is the first due, then the grey count. */
export function agendaWords(
  id: string,
  items: readonly OpenItem[],
  first: FirstDue | null,
  say: { when: (due: string) => string; toClose: (n: number) => string; more: (n: number) => string },
): AgendaWord[] {
  const mine = first?.id === id ? first : null;
  const n = items.length - (mine ? 1 : 0);
  const words: AgendaWord[] = [];
  if (mine) words.push({ text: `${mine.text} · ${say.when(mine.due)}`, urgent: true });
  if (n > 0) words.push(mine ? { text: say.more(n), urgent: false } : { text: say.toClose(n), urgent: false, dot: true });
  return words;
}
