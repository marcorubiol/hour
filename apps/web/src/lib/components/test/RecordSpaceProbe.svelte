<script lang="ts">
  /** Un componente dentro de una ficha: dice «reparto» con `tHere()`. Para record-space.svelte.test.ts. */
  import { tHere } from '$lib/i18n';

  const t = tHere();
</script>

<p>{t('perf.cast', 'es')}</p>
