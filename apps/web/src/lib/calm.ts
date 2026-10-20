/**
 * CALMA COMO FOCO (ADR-139 § 5). Calm is not a grey over the page: it is
 * another composition of each lens, «what is yours today», in one column.
 * It hides, it never dims; whatever it hides is said in one line that opens
 * it (`CalmLine`), so nothing is denied and the counters never lie.
 *
 * This table is the one place that says what each lens keeps. The pages ask
 * it (`shows`) instead of each deciding on its own, the help text describes
 * it, and the unit test pins it. The normal mode is every block: unchanged.
 */

export type CalmLens = 'desk' | 'planner' | 'conversations' | 'books';

/** Every block a lens draws in its normal mode, and whether calm keeps it. */
export const CALM_FOCUS = {
  desk: {
    /** «Lo siguiente»: the day's card. */
    next: true,
    /** «Te espera», today's rows only (`calmWaiting`). */
    waiting_today: true,
    /** What is overdue: one line that opens it in place, never the list. */
    overdue_list: false,
    /** The rest of the week, the «voy», Hour's proposals: a number. */
    waiting_week: false,
    /** «Ver todo por días». */
    see_all: false,
    season: false,
    changed: false,
  },
  planner: {
    /** «N por decidir»: a call to make is not noise (ADR-095). */
    decide: true,
    /** Confirmed rows on the paper. */
    confirmed: true,
    /** Options, proposals, released nights: off the paper, counted in the line. */
    options: false,
    /** Unavailability bands and lanes (a clash with one still shows). */
    blackouts: false,
    /** The census strip: one sentence instead. */
    census: false,
    /** The Season's key under the strip. */
    legend: false,
    /** The Season's «Sin cerrar», «Huecos», «Fuera». */
    season_lists: false,
    /** The agenda's week tallies beyond what is confirmed. */
    week_options: false,
  },
  conversations: {
    /** «Te toca»: the replies and the steps due. */
    due: true,
    /** «Añadir conversación» stays where it is. */
    add: true,
    /** Temperature, season, cold, last mailout. */
    sales: false,
    /** The table. */
    list: false,
    /** The team's threads. */
    threads: false,
  },
  books: {
    /** One figure: what comes in over the next thirty days. */
    inflow_figure: true,
    /** «Pide atención». */
    attention: true,
    /** The other three figures (to collect, to invoice, the season). */
    other_figures: false,
    /** «Lo que entra», month by month. */
    inflow_months: false,
    /** The book itself. */
    ledger: false,
  },
} as const satisfies Record<CalmLens, Record<string, boolean>>;

export type CalmBlock<L extends CalmLens> = keyof (typeof CALM_FOCUS)[L];

/** Whether a lens draws a block: always outside calm, the table's word inside. */
export function shows<L extends CalmLens>(lens: L, block: CalmBlock<L>, calm: boolean): boolean {
  return !calm || (CALM_FOCUS[lens][block] as boolean);
}

/** The Planner's facts line in calm: one sentence, the census said once. */
export interface PlannerCalmFacts {
  /** Confirmed in the window, when the view counts one (Season, Month). */
  confirmed: number | null;
  /** Options in the window: off the paper, so the line says how many. */
  options: number | null;
}

/**
 * What the Planner says about its window in calm. The Season and the Month
 * count a bounded window, so they say both figures; the Day, the Agenda and
 * the Board count nothing (a view counts what it draws, or nothing), so they
 * only say that the options wait outside.
 */
export function plannerCalmFacts(
  view: 'overview' | 'day' | 'agenda' | 'month' | 'board',
  stats: { confirmed: number; holds: number },
): PlannerCalmFacts {
  if (view === 'overview' || view === 'month') return { confirmed: stats.confirmed, options: stats.holds };
  return { confirmed: null, options: null };
}
