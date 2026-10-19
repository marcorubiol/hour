<script lang="ts">
  /**
   * RecordHead: the one head of a record's page (performance, road sheet,
   * conversation, person, project, line, space, each section of Settings),
   * ADR-139 § 4. A record is a small portada, so it wears the lens frame:
   * the same title row and rule as `LensHeader` (the `.lenshead*` classes,
   * one source), the title at the lens size and always in its italic, never
   * larger than the portada it hangs from.
   *
   *   space › project › Función                       (address, mono)
   *   ┌──────────────────────────────────────────────┐
   *   │ [mark] Teatre Municipal de Girona   [actions] │  ← title row, ruled
   *   │ confirmado · sáb 14 nov · Girona              │  ← facts
   *   │ (band: «Falta», ADR-139 § 2, phase 2)          │
   *
   * The address ends with the kind of thing, not its name (the title says it
   * once). `facts` is the line under the title; `band` is room for the
   * «Falta» strip, which no page passes yet.
   */
  import type { Snippet } from 'svelte';
  import LensTitle from '$lib/components/LensTitle.svelte';
  import type { Crumb } from '$lib/record-crumbs';
  import { t, appLocale } from '$lib/i18n';

  interface Props {
    /** Ancestry, then the kind of record as the last, unlinked crumb. */
    crumbs: Crumb[];
    title: string;
    /** The identity mark before the title (a project's monogram): one pack, glyph first. */
    mark?: Snippet;
    /** What acts on the whole record, at the end of the title row. */
    actions?: Snippet;
    /** The line under the title: each child is a fact, `·` between them. */
    facts?: Snippet;
    /** The strip under the facts (phase 2: what is missing, with its verb). */
    band?: Snippet;
  }

  let { crumbs, title, mark, actions, facts, band }: Props = $props();

  const locale = appLocale();
</script>

<header class="lenshead record-head">
  {#if crumbs.length > 0}
    <nav class="record-head__crumbs" aria-label={t('shell.breadcrumb', locale)}>
      {#each crumbs as c, i (i)}
        {#if i > 0}<span class="record-head__sep" aria-hidden="true">›</span>{/if}
        {#if c.href}
          <a class="record-head__crumb" href={c.href}
            >{#if c.accent}<span class="record-head__dot" style={`--c: ${c.accent}`} aria-hidden="true"></span>{/if}{c.label}</a
          >
        {:else}
          <span class="record-head__crumb" aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>
        {/if}
      {/each}
    </nav>
  {/if}
  <div class="lenshead__titlerow">
    <div class="lenshead__lead">
      {#if mark}{@render mark()}{/if}
      <h1 class="lenshead__title"><LensTitle text={title} /></h1>
    </div>
    {#if actions}<span class="lenshead__tools">{@render actions()}</span>{/if}
  </div>
  {#if facts}<div class="lenshead__sub">{@render facts()}</div>{/if}
  {#if band}<div class="record-head__band">{@render band()}</div>{/if}
</header>
