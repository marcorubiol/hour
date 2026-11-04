<script lang="ts">
  /**
   * «También está apuntada a {lista}» (ADR-173 § 7; tarea 103): una persona
   * del público y un contacto son registros aparte, y esta línea es lo único
   * que los junta, calculada al leer. Sin listas, no pinta nada.
   */
  import { t, type Locale } from '$lib/i18n';
  import type { AudienceAlso } from '$lib/audience';

  interface Props {
    items: AudienceAlso[];
    workspaceSlug: string;
    locale: Locale;
  }

  let { items, workspaceSlug, locale }: Props = $props();
</script>

{#if items.length > 0}
  <p class="also" data-testid="audience-also">
    <span class="also__lead">{t('audience.also', locale)}</span>
    {#each items as a, i (a.audience_id)}
      <span class="also__item">
        <a href={`/h/${workspaceSlug}/audience/${a.audience_id}`}>{a.name}</a>{#if a.status === 'pending'}
          <span class="also__state">({t('audience.also_pending', locale)})</span>{/if}{i < items.length - 1 ? ',' : ''}
      </span>
    {/each}
  </p>
{/if}

<style>
  @layer components {
    .also {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-xs);
      margin: 0;
      font-size: var(--text-s);
    }
    .also__lead,
    .also__state {
      color: var(--text-muted);
    }
  }
</style>
