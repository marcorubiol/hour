<script lang="ts">
  /**
   * LensSwitcher — the Desk · Planner · Conversations · Money segmented
   * control (ADR-065/067/075). Extracted from the shell chrome so a lens can
   * host it in its OWN header row, beside its title (the Desk does this; the
   * design puts the title and the switcher on one line). The active lens is
   * read from the route so a direct URL visit highlights correctly; picking
   * one sets the lens store (instant feedback) and the link navigates.
   *
   * Links in a `nav`, not tabs: each one goes to another page (no tabpanel,
   * no arrow keys), so it can open in a new tab or be long-pressed on a
   * phone, and the current one says `aria-current="page"` (Desk review,
   * móvil #7).
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { page } from '$app/state';
  import { useLens, type Lens } from '$lib/stores/lens.svelte';
  import { detectLocale, t } from '$lib/i18n';
  import { moneyAccessAnyQueryOptions } from '$lib/bolo-queries';
  import { lensOn } from '$lib/lenses.svelte';

  const lens = useLens();
  const locale = detectLocale(navigator.language);

  // Desk is the home/digest, not a peer lens (grill 2026-07-23): it gets its own
  // pill; the segmented "view as" holds only the three concern lenses.
  // Cuentas only for whoever reads money in some project (ADR-117).
  // Conversations for everyone: without Converses (ADR-124) its Difusión view
  // is gone but its Equipo view stays, the team's threads (ADR-134). Cuentas
  // keeps its place but draws nothing until an explicit «yes»: it does not
  // blink in for those who have it, nor flash its name at those who do not.
  // And a lens shows only where the space uses it (ADR-132): on AND access.
  const moneyAccess = createQuery(moneyAccessAnyQueryOptions());
  let moneyPending = $derived($moneyAccess.isPending);
  let VIEW_AS = $derived<{ id: Lens; label: string }[]>(
    [
      { id: 'planner' as const, label: t('lens.planner', locale) },
      { id: 'conversations' as const, label: t('lens.conversations', locale) },
      ...($moneyAccess.data?.read_money === true || moneyPending
        ? [{ id: 'books' as const, label: t('lens.money', locale) }]
        : []),
    ].filter((v) => lensOn(v.id)),
  );

  let active = $derived((page.url.pathname.split('/')[2] ?? 'desk') as Lens);

  const pick = (view: Lens) => lens.set(view);
</script>

<nav class="lensswitch-wrap" aria-label={t('lens.nav_aria', locale)}>
  <a
    href="/h/desk"
    class="lensswitch__home"
    class:is-on={active === 'desk'}
    aria-current={active === 'desk' ? 'page' : undefined}
    onclick={() => pick('desk')}
  >
    {t('lens.desk', locale)}
  </a>
  <div class="lensswitch">
    {#each VIEW_AS as v (v.id)}
      <a
        href="/h/{v.id}"
        aria-current={active === v.id ? 'page' : undefined}
        class:is-on={active === v.id}
        class:is-reserved={v.id === 'books' && moneyPending}
        aria-hidden={v.id === 'books' && moneyPending ? 'true' : undefined}
        tabindex={v.id === 'books' && moneyPending ? -1 : undefined}
        onclick={() => pick(v.id)}
      >
        {v.label}
      </a>
    {/each}
  </div>
</nav>

<style>
  .is-reserved {
    visibility: hidden;
  }
  .lensswitch-wrap {
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
  }
  .lensswitch__home,
  .lensswitch a {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }
  .lensswitch__home {
    min-block-size: var(--touch-target);
    appearance: none;
    border: 1px solid var(--border-color-dark);
    background: var(--bg-ultra-light);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: var(--text-s);
    color: var(--text-muted);
    padding-block: var(--space-2xs);
    padding-inline: var(--space-m);
    border-radius: var(--radius-circle);
    transition:
      background var(--transition),
      color var(--transition);
  }
  .lensswitch__home:hover {
    color: var(--text-color);
  }
  .lensswitch__home.is-on {
    background: var(--text-color);
    color: var(--bg);
    border-color: var(--text-color);
  }
  .lensswitch {
    display: inline-flex;
    background: var(--bg-ultra-light);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    padding: 2px;
  }
  .lensswitch a {
    min-block-size: var(--touch-target);
    appearance: none;
    border: 0;
    background: transparent;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: var(--text-s);
    color: var(--text-muted);
    padding-block: var(--space-2xs);
    padding-inline: var(--space-m);
    border-radius: var(--radius-circle);
    transition:
      background var(--transition),
      color var(--transition);
  }
  .lensswitch a:hover {
    color: var(--text-color);
  }
  .lensswitch a.is-on {
    background: var(--text-color);
    color: var(--bg);
  }
  /* On a phone the four have to fit one measure (390 less the gutters):
     the pills keep their shape and give up half their side air. */
  @media (max-width: 47.999rem) {
    .lensswitch__home,
    .lensswitch a {
      padding-inline: var(--space-s);
    }
  }
</style>
