<script lang="ts">
  /**
   * /h — the hall: the calm landing behind the logo (Marco's design,
   * 2026-07-16). A time-aware greeting, today's date, and one door —
   * "posa'm al dia" — straight to /h/desk. The cross-space digest that
   * used to live here died 2026-07-17: Desk IS the catch-up surface
   * (ADR-065), no intermediate page. The left rail's scope rows also
   * navigate to /h/desk when clicked from here (see the shell).
   *
   * Phase 0 voice is Catalan (Marco + Anouk); the strings live here until
   * the languages setting is wired.
   */
  import { goto } from '$app/navigation';
  import { session } from '$lib/session.svelte';

  // Matí / tarda / nit — recomputed on each mount (every landing).
  const hourNow = new Date().getHours();
  const greeting =
    hourNow < 6 || hourNow >= 21 ? 'Bona nit' : hourNow < 14 ? 'Bon dia' : 'Bona tarda';

  let firstName = $derived(
    (session.user?.name ?? session.user?.email?.split('@')[0] ?? '').split(/\s+/)[0] ?? '',
  );

  // "dijous · 16 juliol" — CSS mono-caps does the shouting.
  const today = new Date();
  const dateLabel = `${new Intl.DateTimeFormat('ca', { weekday: 'long' }).format(today)} · ${today.getDate()} ${new Intl.DateTimeFormat('ca', { month: 'long' }).format(today)}`;
</script>

<section class="hall" aria-label="Home">
    <div class="hall__center">
      <h1 class="hall__greeting">{greeting}{firstName ? `, ${firstName}` : ''}</h1>
      <p class="hall__date">{dateLabel}</p>
      <button type="button" class="hall__door" onclick={() => goto('/h/desk')}>
        <span class="hall__door-glyph" aria-hidden="true">✻</span>
        <span>posa'm al dia</span>
      </button>
    </div>
  </section>

<style>
  .hall {
    /* Fill the content column: viewport minus the top bar minus the shell
       content paddings (--space-l top, --space-xxl bottom) — true by
       construction, no approximations. --header-height cascades from
       .shell in the layout. */
    min-block-size: calc(100vh - var(--header-height) - var(--space-l) - var(--space-xxl));
    display: grid;
    place-items: center;
    /* The warm halo behind the greeting. Mixed from bg tokens so both
       themes hold (ADR-059: light AND dark are contracts). */
    background: radial-gradient(
      ellipse 46% 40% at 50% 46%,
      color-mix(in oklch, var(--bg-ultra-light) 85%, var(--bg)),
      transparent 72%
    );
  }

  .hall__center {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .hall__greeting {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 400;
    font-size: clamp(3rem, 7vw, 6.5rem);
    letter-spacing: -0.02em;
    line-height: 1.05;
    color: var(--heading-color);
  }

  .hall__date {
    margin: 0;
    margin-block-start: var(--space-l);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .hall__door {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    margin-block-start: var(--space-xl);
    padding-block: var(--space-s);
    padding-inline: var(--space-l);
    background: color-mix(in oklch, var(--bg) 55%, transparent);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    font-family: var(--font-sans);
    font-size: var(--text-s);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      color var(--transition),
      border-color var(--transition),
      background var(--transition);
  }
  .hall__door:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
    background: var(--bg-ultra-light);
  }

  .hall__door-glyph {
    color: var(--accent-7);
    line-height: 1;
  }
</style>
