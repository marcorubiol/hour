<script lang="ts">
  /**
   * LensSwitcher: Today · Planner · Conversations · Books (ADR-065/067/075),
   * mounted ONCE, in the shell's frame (ADR-140). The same object on every
   * page of /h, so it never moves: on a desktop it opens the top bar; on a
   * phone it is the bar at the foot of the screen, the four words.
   *
   * What it marks:
   *   - on a lens, that lens, filled: «you are here» (`aria-current="page"`);
   *   - anywhere else (a record, a project, Settings), the lens you came from
   *     (the shell keeps it: `hour_lens`), with a soft stroke and no fill:
   *     «you came from here». One click goes back to it with its view and its
   *     scope. A record's crumb still says where the thing HANGS; this says
   *     which section you are in. Two questions, two places.
   *
   * Links in a `nav`, not tabs: each one goes to another page, so it can open
   * in a new tab or be long-pressed on a phone (Desk review, móvil #7).
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { page } from '$app/state';
  import { useLens, type Lens } from '$lib/stores/lens.svelte';
  import { detectLocale, t } from '$lib/i18n';
  import { moneyAccessAnyQueryOptions } from '$lib/bolo-queries';
  import { lensOn, routedLensOf } from '$lib/lenses.svelte';

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

  /** The lens on screen, when the page is one. */
  let active = $derived(routedLensOf(page.url.pathname));
  /** Off a lens: the one you were working in. */
  let origin = $derived<Lens | null>(active ? null : lens.current);

  const pick = (view: Lens) => lens.set(view);
</script>

<nav class="lensswitch-wrap" aria-label={t('lens.nav_aria', locale)} data-testid="lens-nav">
  <a
    href="/h/desk"
    class="lensswitch__home"
    class:is-on={active === 'desk'}
    class:is-origin={origin === 'desk'}
    aria-current={active === 'desk' ? 'page' : undefined}
    aria-describedby={origin === 'desk' ? 'lens-origin-note' : undefined}
    onclick={() => pick('desk')}
  >
    <span class="lensswitch__word">{t('lens.desk', locale)}</span>
  </a>
  <!-- Hoy is the portada and the digest (ADR-088), not a fourth lens: a
       hairline stands it apart. Drawing only; the nav keeps its four links. -->
  <span class="lensswitch__apart" aria-hidden="true"></span>
  <div class="lensswitch">
    {#each VIEW_AS as v (v.id)}
      <a
        href="/h/{v.id}"
        aria-current={active === v.id ? 'page' : undefined}
        aria-describedby={origin === v.id ? 'lens-origin-note' : undefined}
        class:is-on={active === v.id}
        class:is-origin={origin === v.id}
        class:is-reserved={v.id === 'books' && moneyPending}
        aria-hidden={v.id === 'books' && moneyPending ? 'true' : undefined}
        tabindex={v.id === 'books' && moneyPending ? -1 : undefined}
        onclick={() => pick(v.id)}
      >
        <span class="lensswitch__word">{v.label}</span>
      </a>
    {/each}
  </div>
  <!-- What the stroke says, for whoever does not see it. -->
  <span id="lens-origin-note" hidden>{t('lens.origin_note', locale)}</span>
</nav>

<style>
  .is-reserved {
    visibility: hidden;
  }
  .lensswitch-wrap {
    display: inline-flex;
    align-items: center;
    gap: var(--lens-apart);
  }
  /* The rule between Hoy and the three lenses: a hairline the height of the
     word, centred in the air the wrap's gap gives it on each side. */
  .lensswitch__apart {
    flex: none;
    align-self: center;
    inline-size: var(--line-hairline);
    block-size: 1lh;
    font-size: var(--text-s);
    background: var(--lens-apart-rule);
  }
  .lensswitch__home,
  .lensswitch a {
    display: inline-flex;
    align-items: center;
    min-block-size: var(--touch-target);
    padding-block: var(--space-2xs);
    padding-inline: var(--space-m);
    border-radius: var(--radius-circle);
    font-family: var(--font-sans);
    font-size: var(--text-s);
    color: var(--text-muted);
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background var(--transition),
      color var(--transition),
      border-color var(--transition),
      box-shadow var(--transition);
  }
  .lensswitch__home {
    border: var(--line-hairline) solid var(--border-color-dark);
    background: var(--bg-ultra-light);
  }
  .lensswitch {
    display: inline-flex;
    background: var(--bg-ultra-light);
    border: var(--line-hairline) solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    padding: var(--space-2xs);
  }
  .lensswitch a {
    border: 0;
    background: transparent;
  }
  .lensswitch__home:hover,
  .lensswitch a:hover {
    color: var(--text-color);
  }
  .lensswitch__home.is-on {
    border-color: var(--text-color);
  }
  .lensswitch__home.is-on,
  .lensswitch a.is-on {
    background: var(--text-color);
    color: var(--bg);
  }
  /* «You came from here»: the word in ink and a soft stroke round it, never
     the fill (the fill is «you are here»). The ring is drawn inside the box,
     so the mark moves nothing. */
  .lensswitch__home.is-origin,
  .lensswitch a.is-origin {
    color: var(--text-color);
    box-shadow: inset 0 0 0 var(--line-hairline) var(--lens-origin-stroke);
  }

  /* A tablet with the rail beside it: the bar is narrower than the four
     pills with their desktop air, so they give up half of it. */
  @media (min-width: 48rem) and (max-width: 63.999rem) {
    .lensswitch__home,
    .lensswitch a {
      padding-inline: var(--space-s);
    }
  }

  /* A phone: the bar at the foot of the screen (ADR-140). The four words,
     no icons, in the app's mono voice. Each link is a whole cell of the row
     (the target); the word inside wears the same marks as on a desktop:
     filled here, a stroke where you came from. The home pill and the
     segmented group dissolve into that one row, over the safe area. */
  @media (max-width: 47.999rem) {
    .lensswitch-wrap {
      position: fixed;
      inset-inline: 0;
      inset-block-end: 0;
      z-index: var(--z-sticky);
      display: flex;
      align-items: stretch;
      gap: 0;
      padding-block-end: var(--lensbar-foot);
      padding-inline: max(var(--space-2xs), env(safe-area-inset-left)) max(var(--space-2xs), env(safe-area-inset-right));
      background: var(--bg);
      border-block-start: var(--line-hairline) solid var(--border-color-light);
    }
    .lensswitch {
      display: contents;
    }
    /* The same rule in the bar: between Hoy's cell and the three, the word's
       height, no air of its own (each cell already has it). */
    .lensswitch__apart {
      font-size: var(--text-xs);
    }
    .lensswitch__home,
    .lensswitch a,
    .lensswitch__home.is-on,
    .lensswitch a.is-on,
    .lensswitch__home.is-origin,
    .lensswitch a.is-origin {
      flex: 1 1 auto;
      justify-content: center;
      block-size: var(--lensbar-height);
      min-block-size: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      color: var(--text-muted);
    }
    .lensswitch__word {
      padding-block: var(--space-2xs);
      padding-inline: var(--space-xs);
      border-radius: var(--radius-circle);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      text-transform: uppercase;
      transition:
        background var(--transition),
        color var(--transition),
        box-shadow var(--transition);
    }
    .is-on .lensswitch__word {
      background: var(--text-color);
      color: var(--bg);
    }
    .is-origin .lensswitch__word {
      color: var(--text-color);
      box-shadow: inset 0 0 0 var(--line-hairline) var(--lens-origin-stroke);
    }
  }
</style>
