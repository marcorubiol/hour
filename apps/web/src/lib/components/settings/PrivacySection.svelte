<script lang="ts">
  // ─── privacy state ────────────────────────────────────────────────────
  let privTasksDefault = $state<'shared' | 'private'>('shared');
  let privMoneyVis = $state<'me-only' | 'project' | 'all'>('me-only');
  let privNotesPrivate = $state(true);
  let privDistribution = $state<'me-only' | 'distributors' | 'all'>('me-only');
</script>

<header class="set-mast">
  <p class="eyebrow set-mast__kicker">Boundaries</p>
  <h1 class="set-mast__title"><em>Visibility &amp; privacy</em></h1>
  <p class="set-mast__sub">
    Across your collectives, some things are shared and some are yours
    alone. Defaults here apply to every new project.
  </p>
</header>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">Defaults</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">New tasks default to</div>
        <div class="set-row__hint">You can flip any individual task later.</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-seg">
          <button
            type="button"
            class={privTasksDefault === 'shared' ? 'is-on' : ''}
            onclick={() => (privTasksDefault = 'shared')}
          >Shared</button>
          <button
            type="button"
            class={privTasksDefault === 'private' ? 'is-on' : ''}
            onclick={() => (privTasksDefault = 'private')}
          >Private</button>
        </div>
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Money visibility</div>
        <div class="set-row__hint">Who can see fees, invoices, chases.</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-seg">
          <button
            type="button"
            class={privMoneyVis === 'me-only' ? 'is-on' : ''}
            onclick={() => (privMoneyVis = 'me-only')}
          >Only me</button>
          <button
            type="button"
            class={privMoneyVis === 'project' ? 'is-on' : ''}
            onclick={() => (privMoneyVis = 'project')}
          >Per-project rule</button>
          <button
            type="button"
            class={privMoneyVis === 'all' ? 'is-on' : ''}
            onclick={() => (privMoneyVis = 'all')}
          >All collaborators</button>
        </div>
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Private notes</div>
        <div class="set-row__hint">Your tech notes, drafts, hot takes.</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', privNotesPrivate && 'is-on']
            .filter(Boolean)
            .join(' ')}
          aria-label="Private notes"
          aria-pressed={privNotesPrivate}
          onclick={() => (privNotesPrivate = !privNotesPrivate)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Distribution pipeline</div>
        <div class="set-row__hint">Letters out, warm replies, dead leads.</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-seg">
          <button
            type="button"
            class={privDistribution === 'me-only' ? 'is-on' : ''}
            onclick={() => (privDistribution = 'me-only')}
          >Only me</button>
          <button
            type="button"
            class={privDistribution === 'distributors' ? 'is-on' : ''}
            onclick={() => (privDistribution = 'distributors')}
          >Distributors only</button>
          <button
            type="button"
            class={privDistribution === 'all' ? 'is-on' : ''}
            onclick={() => (privDistribution = 'all')}
          >Everyone</button>
        </div>
      </div>
    </div>
  </div>
</section>
