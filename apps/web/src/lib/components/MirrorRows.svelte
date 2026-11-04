<script lang="ts" module>
  import type { BoloLine } from '$lib/sheet-mirror';
  import type { StatusTone } from '$lib/performance';

  /** Una fila del espejo: con quién (o qué), y debajo sus bolos. */
  export interface MirrorRow {
    key: string;
    /** La conversación: el chat es cada fila (ADR-177 § 4, sin «Abrir el chat»). */
    href: string | null;
    title: string;
    /** Lo nuestro lleva su `IdentityMark`; lo de fuera, el monograma gris (ADR-177 § 3). */
    mark: { kind: 'project'; accent: string; initials: string | null } | { kind: 'organization' };
    /** La relación, en palabra. */
    badge?: { label: string; tone: StatusTone } | null;
    bolos: BoloLine[];
  }
</script>

<script lang="ts">
  /**
   * Las filas que comparten la ficha de la organización y la del proyecto
   * (ADR-177 § 4: espejo, los mismos bloques girados). En la de la sala, una
   * fila por proyecto con su color; en la del proyecto, una por sala en gris.
   * Debajo de cada una, sus bolos: el día, el estado y el importe.
   */
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import ChatMonogram from '$lib/components/ChatMonogram.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';

  interface Props {
    rows: MirrorRow[];
    testid?: string;
  }

  let { rows, testid }: Props = $props();
</script>

<ul class="mirror" role="list" data-testid={testid}>
  {#each rows as r (r.key)}
    <li class="mirror__row" data-testid="mirror-row">
      <div class="mirror__head">
        {#if r.mark.kind === 'project'}
          <IdentityMark accent={r.mark.accent} initials={r.mark.initials} name={r.title} size="var(--chat-mono)" />
        {:else}
          <ChatMonogram name={r.title} />
        {/if}
        {#if r.href}
          <a class="mirror__title" href={r.href}>{r.title}</a>
        {:else}
          <span class="mirror__title">{r.title}</span>
        {/if}
        {#if r.badge}<StateBadge label={r.badge.label} tone={r.badge.tone} />{/if}
      </div>
      {#if r.bolos.length > 0}
        <ul class="mirror__bolos" role="list">
          {#each r.bolos as b (b.id)}
            <li class="mirror__bolo" data-testid="mirror-bolo">
              <span class="mirror__day">
                {#if b.href}<a href={b.href}>{b.day}</a>{:else}{b.day}{/if}
              </span>
              <span class="mirror__what">
                {[b.where, b.functions, b.status].filter(Boolean).join(' · ')}
              </span>
              {#if b.amount}<span class="mirror__amount">{b.amount}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </li>
  {/each}
</ul>

<style>
  @layer components {
    .mirror {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
    }

    .mirror__row {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }

    .mirror__head {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      min-inline-size: 0;
    }

    .mirror__title {
      flex: 1;
      min-inline-size: 0;
      font-size: var(--text-s);
      color: var(--text-color);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    a.mirror__title:hover,
    a.mirror__title:focus-visible,
    .mirror__day a:hover,
    .mirror__day a:focus-visible {
      text-decoration: underline;
    }

    /* The bolos hang under the name, aligned with it (past the mark). */
    .mirror__bolos {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin: 0;
      padding-inline-start: calc(var(--chat-mono) + var(--space-xs));
    }

    .mirror__bolo {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .mirror__day {
      font-family: var(--font-mono);
      letter-spacing: var(--tracking-s);
      min-inline-size: var(--record-label-inline);
    }

    .mirror__day a {
      color: inherit;
      text-decoration: none;
    }

    .mirror__what {
      flex: 1;
      min-inline-size: 0;
    }

    .mirror__amount {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      color: var(--text-color);
    }
  }
</style>
