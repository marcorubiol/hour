<script lang="ts" module>
  import type { BoloLine } from '$lib/sheet-mirror';
  import type { ChatContext } from '$lib/chat-row';

  /** Una fila del espejo: con quién (o qué), y debajo sus bolos. */
  export interface MirrorRow {
    key: string;
    /** La conversación: el chat es cada fila (ADR-177 § 4, sin «Abrir el chat»). */
    href: string | null;
    title: string;
    /**
     * Lo nuestro lleva su `IdentityMark`; lo de fuera, el monograma gris,
     * redondo si es una persona (ADR-177 § 3).
     */
    mark: { kind: 'project'; accent: string; initials: string | null } | { kind: 'organization'; shape?: 'person' | 'organization' };
    /** Qué es y dónde, tras el nombre (lo de fuera: «sala · Girona»). */
    words?: string[];
    /** Lo último que se dijo (mesa, punto 6): quién y qué. */
    lead?: string | null;
    last?: string | null;
    /** El turno en palabras, o la relación (`chatTurn`). */
    context?: ChatContext[];
    bolos: BoloLine[];
  }
</script>

<script lang="ts">
  /**
   * Las filas que comparten la ficha de la organización y la del proyecto
   * (ADR-177 § 4: espejo, los mismos bloques girados). En la de la sala, una
   * fila por proyecto con su color; en la del proyecto, una por sala en gris.
   * Cada fila es la de chat (`ChatRow`): con quién, lo último que se dijo y
   * el turno (mesa, punto 6). Debajo, sus bolos: el día, el estado y el importe.
   */
  import ChatRow from '$lib/components/ChatRow.svelte';

  interface Props {
    rows: MirrorRow[];
    testid?: string;
  }

  let { rows, testid }: Props = $props();
</script>

<ul class="mirror" role="list" data-testid={testid}>
  {#each rows as r (r.key)}
    <li class="mirror__row" data-testid="mirror-row">
      <ChatRow
        flush
        href={r.href}
        title={r.title}
        shape={r.mark.kind === 'organization' ? (r.mark.shape ?? 'organization') : 'organization'}
        words={r.words ?? []}
        mark={r.mark.kind === 'project' ? { accent: r.mark.accent, initials: r.mark.initials, name: r.title } : null}
        lead={r.lead ?? null}
        last={r.last ?? null}
        context={r.context ?? []}
      />
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

    .mirror__day a:hover,
    .mirror__day a:focus-visible {
      text-decoration: underline;
    }

    /* The bolos hang under the name, aligned with it (past the chat row's mark). */
    .mirror__bolos {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin: 0;
      padding-inline-start: calc(var(--chat-mono) + var(--space-s));
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
