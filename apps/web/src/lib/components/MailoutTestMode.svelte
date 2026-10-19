<script lang="ts">
  /**
   * El aviso de modo de prueba del envío en bloque (ADR-111, ADR-114 § 5):
   * mientras el envío sea simulado, la pantalla lo dice. Uno solo para Ajustes
   * y la pantalla del envío; nunca nombra el servicio.
   */
  interface Props {
    title: string;
    body: string;
  }

  let { title, body }: Props = $props();
</script>

<div class="test-mode" role="note" data-testid="mailout-simulated">
  <p class="test-mode__title">{title}</p>
  <p>{body}</p>
</div>

<style>
  @layer components {
    .test-mode {
      padding: var(--space-s) var(--space-m);
      background: var(--bg-light);
      border: var(--line-hairline) solid var(--border-color-light);
      border-inline-start: var(--line-thick) solid var(--warning, var(--border-color-dark));
      border-radius: var(--radius);
      font-size: var(--text-s);
      line-height: 1.5;
    }
    .test-mode p {
      margin: 0;
    }
    .test-mode__title {
      font-weight: 500;
    }
  }
</style>
