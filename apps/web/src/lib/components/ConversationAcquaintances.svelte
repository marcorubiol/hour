<script lang="ts">
  /**
   * «Lo conozco» en la ficha de una conversación (ADR-138 § 5): una marca por
   * cada contacto vigente, con su nombre. La marca va por la persona, no por
   * la conversación: marcarla aquí es marcarla en su ficha y en cualquier otra
   * conversación donde esté.
   */
  import ConceptHint from '$lib/components/ConceptHint.svelte';
  import Acquaintance from '$lib/components/Acquaintance.svelte';
  import type { ConversationContact } from '$lib/conversation';
  import { t, type Locale } from '$lib/i18n';

  interface Props {
    workspaceId: string;
    contacts: readonly ConversationContact[];
    locale: Locale;
  }

  let { workspaceId, contacts, locale }: Props = $props();

  /** Who is a contact now: a closed one (`until`) is history, not someone to know. */
  let current = $derived(contacts.filter((c) => c.person && !c.until));
</script>

{#if current.length > 0}
  <div class="known">
    <p class="eyebrow eyebrow--sub">{t('acquaintance.known', locale)}<ConceptHint concept="known" /></p>
    {#each current as c (c.person_id)}
      <Acquaintance {workspaceId} personId={c.person_id} name={c.person!.full_name} {locale} />
    {/each}
  </div>
{/if}

<style>
  @layer components {
    .known {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .known p {
      margin: 0;
    }
  }
</style>
