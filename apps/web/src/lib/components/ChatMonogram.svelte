<script lang="ts">
  /**
   * El monograma de con quién se habla (ADR-176; forma, ADR-177 § 3): las
   * iniciales en gris, porque es de fuera. Redondo es una persona (una
   * organización que es una sola persona y se llama como ella, también:
   * `chatWho`); cuadrado, una organización. La forma nunca va sola: quien lo
   * aloja pone la palabra al lado («por libre», «sala · Girona»).
   *
   * `group` es el trazo discontinuo de un hilo de bolo, que ADR-177 § 3
   * sustituye por el `IdentityMark` de su espectáculo: la fila de la lista ya
   * no lo usa; queda mientras la cabecera del grupo no cambie.
   *
   * Lo dibujan la fila de la lista de chats y la cabecera del hilo: un solo
   * sitio para este tratamiento. No es la identidad de un proyecto, que es
   * `IdentityMark`. Decorativo: el nombre ya está al lado, así que va oculto
   * al lector. Su tamaño es `--chat-mono` (tokens.css); quien lo aloja puede
   * cambiarlo.
   */
  import { initials } from '$lib/monogram';

  interface Props {
    name: string | null | undefined;
    shape?: 'person' | 'organization';
    group?: boolean;
  }

  let { name, shape = 'organization', group = false }: Props = $props();
</script>

<span class="mono" class:mono--person={shape === 'person' && !group} class:mono--group={group} aria-hidden="true"
  >{initials(name)}</span
>

<style>
  @layer components {
    .mono {
      display: inline-grid;
      flex-shrink: 0;
      place-items: center;
      inline-size: var(--chat-mono);
      block-size: var(--chat-mono);
      border: var(--line-hairline) solid transparent;
      border-radius: var(--radius-m);
      background: var(--bg-light);
      color: var(--text-muted);
      font-size: var(--text-xs);
      font-weight: 500;
    }
    .mono--person {
      border-radius: var(--radius-circle);
    }
    .mono--group {
      border: var(--line-hairline) dashed var(--border-color-dark);
      background: transparent;
    }
  }
</style>
