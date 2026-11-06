<script lang="ts" module>
  /**
   * Los glifos del hilo y del campo de escribir de una conversación (ADR-184):
   * qué fue cada cosa, de un vistazo, siempre al lado de su palabra (ADR-177
   * § 3: la forma nunca va sola). Un trazo, el tamaño del texto que acompaña,
   * el color del texto. Un canal nuevo trae aquí su glifo.
   */
  export type ThreadIconName = 'mail' | 'call' | 'message' | 'meeting' | 'team' | 'note' | 'mailout' | 'done' | 'details' | 'plus' | 'whatsapp' | 'sms' | 'telegram';
</script>

<script lang="ts">
  let { name }: { name: ThreadIconName } = $props();
</script>

<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  {#if name === 'mail'}
    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5 12 13l8.5-6.5" />
  {:else if name === 'call'}
    <path
      d="M5 3.5h3.2l1.6 4.4-2.1 1.4a11.5 11.5 0 0 0 7 7l1.4-2.1 4.4 1.6v3.2a2 2 0 0 1-2.2 2A17 17 0 0 1 3 5.7a2 2 0 0 1 2-2.2z"
    />
  {:else if name === 'message'}
    <path d="M20.5 11.5a8 8 0 0 1-11.8 7L3.5 20l1.4-4.7A8 8 0 1 1 20.5 11.5z" />
  {:else if name === 'meeting'}
    <circle cx="9" cy="8" r="3" /><path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle
      cx="17"
      cy="9"
      r="2.4"
    /><path d="M16.5 14c2.7.2 4.5 2.2 4.5 5" />
  {:else if name === 'team'}
    <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
  {:else if name === 'note'}
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
  {:else if name === 'mailout'}
    <path d="M3 10v4h3.5l7 4.5v-13L6.5 10H3z" /><path d="M17 9a4.2 4.2 0 0 1 0 6" />
  {:else if name === 'done'}
    <path d="M5 12.5 10 17l9-10" />
  {:else if name === 'whatsapp'}
    <!-- A bubble with a handset: a chat that is also a phone. Not the brand's mark. -->
    <path d="M20.5 11.5a8 8 0 0 1-11.8 7L3.5 20l1.4-4.7A8 8 0 1 1 20.5 11.5z" /><path
      d="M9.2 8.6h1.2l.6 1.5-.8.6a4.2 4.2 0 0 0 2.4 2.4l.6-.8 1.5.6v1.2a.8.8 0 0 1-.9.8 6 6 0 0 1-5.4-5.4.8.8 0 0 1 .8-.9z"
    />
  {:else if name === 'sms'}
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.2" /><path d="M9.5 8h5M9.5 11.5h5M11 18h2" />
  {:else if name === 'telegram'}
    <path d="M21 4 3 11l6 2.5L19 7l-8 8 .5 5 3-3.5L19 20z" />
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14" />
  {:else}
    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" />
  {/if}
</svg>

<style>
  @layer components {
    .ticon {
      flex: none;
      inline-size: var(--icon-size);
      block-size: var(--icon-size);
      fill: none;
      stroke: currentColor;
      stroke-width: var(--icon-stroke);
      stroke-linecap: round;
      stroke-linejoin: round;
      /* Sits on the text's baseline, not above it. */
      transform: translateY(2px);
    }
  }
</style>
