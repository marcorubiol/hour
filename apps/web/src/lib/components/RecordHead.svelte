<script module lang="ts">
  import type { HelpConcept } from '$lib/help';

  /** A verb on the whole record (tarea 134): one treatment for every head. */
  export interface RecordTool {
    label: string;
    onclick?: () => void;
    /** A place, not an act: drawn as the same button. */
    href?: string;
    loading?: boolean;
    /** The «i» that explains the word, after it (the road sheet). */
    concept?: HelpConcept;
    testid?: string;
  }

</script>

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
   *
   * What acts on the whole record is `tools`: data, not markup, so every
   * record's head says its verbs the same way (tarea 134): a word in the
   * hairline button at the row's size, at the end of the title row, in the
   * order given. A link (the road sheet) wears the same button. `actions`
   * stays for heads that carry something that is not a verb (a road sheet's
   * own tools, a settings section).
   */
  import type { Snippet } from 'svelte';
  import LensTitle from '$lib/components/LensTitle.svelte';
  import Button from '$lib/components/Button.svelte';
  import ConceptHint from '$lib/components/ConceptHint.svelte';
  import type { Crumb } from '$lib/record-crumbs';
  import { t, appLocale } from '$lib/i18n';

  interface Props {
    /** Ancestry, then the kind of record as the last, unlinked crumb. */
    crumbs: Crumb[];
    title: string;
    /** The title is also another record's name: it links there (a conversation's venue, ADR-159). */
    titleHref?: string | null;
    /** The identity mark before the title (a project's monogram): one pack, glyph first. */
    mark?: Snippet;
    /** The verbs on the whole record, at the end of the title row. */
    tools?: readonly RecordTool[];
    /** Anything else at the end of the title row (not a verb). */
    actions?: Snippet;
    /** The line under the title: each child is a fact, `·` between them. */
    facts?: Snippet;
    /** The strip under the facts (phase 2: what is missing, with its verb). */
    band?: Snippet;
  }

  let { crumbs, title, titleHref = null, mark, tools = [], actions, facts, band }: Props = $props();

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
          <span class="record-head__crumb" aria-current={i === crumbs.length - 1 ? 'page' : undefined}
            >{#if c.accent}<span class="record-head__dot" style={`--c: ${c.accent}`} aria-hidden="true"></span>{/if}{c.label}</span
          >
        {/if}
      {/each}
    </nav>
  {/if}
  <div class="lenshead__titlerow">
    <div class="lenshead__lead">
      {#if mark}{@render mark()}{/if}
      <h1 class="lenshead__title">
        {#if titleHref}<a class="record-head__titlelink" href={titleHref}><LensTitle text={title} /></a>{:else}<LensTitle
            text={title}
          />{/if}
      </h1>
    </div>
    {#if tools.length > 0 || actions}
      <span class="lenshead__tools">
        {#each tools as tool (tool.label)}
          {#if tool.href}
            <span class="record-head__tool"
              ><a class="btn--secondary btn--xs" href={tool.href} data-testid={tool.testid}>{tool.label}</a
              >{#if tool.concept}<ConceptHint concept={tool.concept} />{/if}</span
            >
          {:else}
            <span class="record-head__tool" data-testid={tool.testid}
              ><Button variant="secondary" size="xs" loading={tool.loading} onclick={tool.onclick}>{tool.label}</Button
              >{#if tool.concept}<ConceptHint concept={tool.concept} />{/if}</span
            >
          {/if}
        {/each}
        {#if actions}{@render actions()}{/if}
      </span>
    {/if}
  </div>
  {#if facts}<div class="lenshead__sub">{@render facts()}</div>{/if}
  {#if band}<div class="record-head__band">{@render band()}</div>{/if}
</header>
