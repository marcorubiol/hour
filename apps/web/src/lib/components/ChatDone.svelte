<script lang="ts">
  /**
   * «Ya está» en la fila de chat (ADR-177): un toque y la fila sale de «Nos
   * toca». Lo pendiente (el «cómo» y «Deshacer») no es de la fila, que se va,
   * sino de `ChatDoneLine`, encima de la lista (`$lib/chat-done.svelte`).
   */
  import { t, type Locale } from '$lib/i18n';
  import { done, settleDone } from '$lib/chat-done.svelte';

  interface Props {
    conversationId: string;
    /** Con quién, para el lector de pantalla («Teatre de la Llum: ya está»). */
    name: string;
    locale: Locale;
    /** Las listas se vuelven a leer: la fila se va. */
    refresh: () => void;
  }

  let { conversationId, name, locale, refresh }: Props = $props();
</script>

<button
  type="button"
  class="fact-act"
  disabled={done.busy !== null}
  aria-label={t('chat.done_aria', locale, { name })}
  onclick={() => void settleDone(conversationId, name, locale, refresh)}>{t('chat.done', locale)}</button
>
