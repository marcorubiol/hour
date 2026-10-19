/**
 * The «Falta» strip of a line or a project (ADR-139 § 2): its conversations
 * whose next step is due, in words, each with «abrir»; past three, the rest
 * as one count with «ver» to where the list is. The rule is `lineMissing`;
 * this only says it. Read from the conversations the page already has.
 */
import type { MissingItem } from '$lib/components/MissingBand.svelte';
import { conversationTitle, relativeContactDate, type ConversationItem } from './conversation';
import { t, type Locale } from './i18n';
import { lineMissing } from './record-missing';

export type StepsDueRow = Pick<ConversationItem, 'id' | 'relation' | 'next_action_at' | 'organization' | 'person'>;

export function stepsDueBand(
  rows: readonly StepsDueRow[],
  opts: { today: string; total?: number; workspaceSlug: string; moreHref?: string | null; locale: Locale },
): MissingItem[] {
  const { locale } = opts;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return lineMissing(rows, opts.today, { total: opts.total }).map((m) => {
    if (m.kind === 'steps_due_more') {
      const key = m.atLeast
        ? 'record.missing_steps_due_more_atleast'
        : m.count === 1
          ? 'record.missing_steps_due_more_one'
          : 'record.missing_steps_due_more_many';
      return {
        id: 'steps_due_more',
        text: t(key, locale, { n: m.count }),
        verbs: opts.moreHref ? [{ label: t('record.verb_see', locale), href: opts.moreHref }] : [],
      };
    }
    const who = conversationTitle(byId.get(m.conversationId)!);
    return {
      id: `step_${m.conversationId}`,
      text: who ? t('record.missing_step_due_of', locale, { who }) : t('record.missing_step_due', locale),
      meta: relativeContactDate(m.day, locale),
      verbs: [{ label: t('record.verb_open', locale), href: `/h/${opts.workspaceSlug}/conversation/${m.conversationId}` }],
    };
  });
}
