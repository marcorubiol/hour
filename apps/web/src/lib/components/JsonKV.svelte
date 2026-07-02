<script module lang="ts">
  import type { Json } from '$lib/db-types';

  /** True when a jsonb value has anything to show (non-empty object/array
      or a scalar) — the shared "should this section render" check. */
  export function hasJsonContent(v: Json | null | undefined): boolean {
    if (v === null || v === undefined) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  }
</script>

<script lang="ts">
  /**
   * JsonKV — generic reader for the performance jsonb columns
   * (logistics / hospitality / technical). Their internal shapes are
   * deliberately undecided (ADR-023: "finalized at implementation"), so
   * this renders whatever is there — flat keys, nested objects, arrays —
   * without imposing a schema. When the shapes crystallize, purpose-built
   * sections can replace this.
   */

  import JsonKV from './JsonKV.svelte';

  interface Props {
    value: Json;
  }

  let { value }: Props = $props();

  function label(key: string): string {
    return key.replace(/_/g, ' ');
  }

  let entries = $derived(
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, Json>)
      : [],
  );

  let items = $derived(Array.isArray(value) ? (value as Json[]) : []);

  function isScalar(v: Json): boolean {
    return v === null || typeof v !== 'object';
  }
</script>

{#if entries.length > 0}
  <dl class="json-kv">
    {#each entries as [key, val] (key)}
      <dt>{label(key)}</dt>
      <dd>
        {#if isScalar(val)}
          {val ?? '—'}
        {:else}
          <JsonKV value={val} />
        {/if}
      </dd>
    {/each}
  </dl>
{:else if items.length > 0}
  <ul class="json-kv__list">
    {#each items as item, i (i)}
      <li>
        {#if isScalar(item)}
          {item ?? '—'}
        {:else}
          <JsonKV value={item} />
        {/if}
      </li>
    {/each}
  </ul>
{:else if value !== null && typeof value !== 'object'}
  <p class="json-kv__scalar">{value}</p>
{/if}

<style>
  @layer components {
    .json-kv {
      display: grid;
      grid-template-columns: minmax(8rem, max-content) 1fr;
      gap: var(--space-2xs) var(--space-m);
      margin: 0;
    }

    .json-kv dt {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      text-transform: lowercase;
    }

    .json-kv dd {
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-color);
      overflow-wrap: anywhere;
    }

    .json-kv__list {
      margin: 0;
      padding-inline-start: 1.1em;
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .json-kv__scalar {
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-color);
    }
  }
</style>
