<script lang="ts">
  // ─── languages state ──────────────────────────────────────────────────
  // Working languages (which langs the user speaks) deferred: it's Person
  // metadata, not an app setting. Only the app-interface language remains.
  let appLanguage = $state<'ca' | 'es' | 'en' | 'fr'>('en');
</script>

<header class="set-mast">
  <p class="eyebrow set-mast__kicker">Materials</p>
  <h1 class="set-mast__title"><em>Languages</em></h1>
  <p class="set-mast__sub">
    Press kits, dossiers, riders — Hour produces each in the languages
    you work in.
  </p>
</header>

<!-- "Working languages" list killed: it's metadata of the Person
     entity (which languages Marco speaks), not an app setting.
     Belongs on the Person profile when that page exists. -->

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">Interface</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">App language</div>
        <div class="set-row__hint">The Hour interface itself.</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-seg">
          <button
            type="button"
            class={appLanguage === 'ca' ? 'is-on' : ''}
            onclick={() => (appLanguage = 'ca')}
          >Català</button>
          <button
            type="button"
            class={appLanguage === 'es' ? 'is-on' : ''}
            onclick={() => (appLanguage = 'es')}
          >Castellano</button>
          <button
            type="button"
            class={appLanguage === 'en' ? 'is-on' : ''}
            onclick={() => (appLanguage = 'en')}
          >English</button>
          <button
            type="button"
            class={appLanguage === 'fr' ? 'is-on' : ''}
            onclick={() => (appLanguage = 'fr')}
          >Français</button>
        </div>
      </div>
    </div>
  </div>
</section>
