<script lang="ts">
  import { onMount } from 'svelte';
  import { session } from '$lib/session.svelte';
  import {
    isMasterViewEnabled,
    getMasterViewPath,
    setMasterViewEnabled,
    clearMasterViewPath,
  } from '$lib/master-view';

  let userEmail = $derived(session.user?.email ?? '');

  // ─── notifications state ──────────────────────────────────────────────
  let notifDigest = $state<'off' | 'weekday' | 'daily'>('weekday');
  let notifWeeklyReview = $state(true);
  let notifWarmReply = $state(true);
  let notifMoneyIn = $state(true);
  let notifMoneyOverdue = $state(true);
  let notifDayOfShow = $state(true);
  let notifEmail = $state(true);
  let notifPush = $state(true);
  let quietStart = $state('22:00');
  let quietEnd = $state('08:00');

  // ─── Master View (D-PRE-05) — real wire ───────────────────────────────
  let masterViewEnabled = $state(false);
  let masterViewPath = $state<string | null>(null);

  function refreshMasterView() {
    masterViewEnabled = isMasterViewEnabled();
    masterViewPath = getMasterViewPath();
  }

  onMount(refreshMasterView);

  function toggleMasterView(next: boolean) {
    masterViewEnabled = next;
    setMasterViewEnabled(next);
    refreshMasterView();
  }

  function clearMasterView() {
    clearMasterViewPath();
    refreshMasterView();
  }
</script>

<header class="set-mast">
  <p class="eyebrow set-mast__kicker">Quiet by default</p>
  <h1 class="set-mast__title"><em>Notifications</em></h1>
  <p class="set-mast__sub">
    Hour only nudges you when something genuinely changed. You decide
    where.
  </p>
</header>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">Digest</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Daily digest</div>
        <div class="set-row__hint">A morning summary of your week.</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-seg">
          <button
            type="button"
            class={notifDigest === 'off' ? 'is-on' : ''}
            onclick={() => (notifDigest = 'off')}
          >Off</button>
          <button
            type="button"
            class={notifDigest === 'weekday' ? 'is-on' : ''}
            onclick={() => (notifDigest = 'weekday')}
          >Mon–Fri</button>
          <button
            type="button"
            class={notifDigest === 'daily' ? 'is-on' : ''}
            onclick={() => (notifDigest = 'daily')}
          >Every day</button>
        </div>
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Weekly review</div>
        <div class="set-row__hint">Sunday evening, ten minutes of looking back.</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifWeeklyReview && 'is-on'].filter(Boolean).join(' ')}
          aria-label="Weekly review"
          aria-pressed={notifWeeklyReview}
          onclick={() => (notifWeeklyReview = !notifWeeklyReview)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
  </div>
</section>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">Priority alerts</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Warm reply lands</div>
        <div class="set-row__hint">Someone you pitched said yes-ish.</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifWarmReply && 'is-on'].filter(Boolean).join(' ')}
          aria-label="Warm reply lands"
          aria-pressed={notifWarmReply}
          onclick={() => (notifWarmReply = !notifWarmReply)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Money in</div>
        <div class="set-row__hint">A wire matches an invoice.</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifMoneyIn && 'is-on'].filter(Boolean).join(' ')}
          aria-label="Money in"
          aria-pressed={notifMoneyIn}
          onclick={() => (notifMoneyIn = !notifMoneyIn)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Money overdue</div>
        <div class="set-row__hint">A fee past 60 days.</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifMoneyOverdue && 'is-on'].filter(Boolean).join(' ')}
          aria-label="Money overdue"
          aria-pressed={notifMoneyOverdue}
          onclick={() => (notifMoneyOverdue = !notifMoneyOverdue)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Day-of-show</div>
        <div class="set-row__hint">Six hours before doors.</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifDayOfShow && 'is-on'].filter(Boolean).join(' ')}
          aria-label="Day-of-show"
          aria-pressed={notifDayOfShow}
          onclick={() => (notifDayOfShow = !notifDayOfShow)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
  </div>
</section>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">Channels</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Email</div>
        <div class="set-row__hint">{userEmail || '—'}</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifEmail && 'is-on'].filter(Boolean).join(' ')}
          aria-label="Email notifications"
          aria-pressed={notifEmail}
          onclick={() => (notifEmail = !notifEmail)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Mobile push</div>
        <div class="set-row__hint">iOS app · Android app</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifPush && 'is-on'].filter(Boolean).join(' ')}
          aria-label="Mobile push notifications"
          aria-pressed={notifPush}
          onclick={() => (notifPush = !notifPush)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Quiet hours</div>
        <div class="set-row__hint">No pings on the road.</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-hours">
          <input class="input--tight" type="text" bind:value={quietStart} />
          <span class="sep">→</span>
          <input class="input--tight" type="text" bind:value={quietEnd} />
        </div>
      </div>
    </div>
  </div>
</section>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">Browser memory</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Master View</div>
        <div class="set-row__hint">
          Remember the last page you visited inside a project and open
          there next sign-in. Per-browser; not synced across devices.
        </div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', masterViewEnabled && 'is-on']
            .filter(Boolean)
            .join(' ')}
          aria-label="Master View — remember last visited page"
          aria-pressed={masterViewEnabled}
          onclick={() => toggleMasterView(!masterViewEnabled)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
    {#if masterViewEnabled && masterViewPath}
      <div class="set-row">
        <div class="set-row__lead">
          <div class="set-row__label">Saved view</div>
          <div class="set-row__hint">
            Will open <code class="set-codeline">{masterViewPath}</code>
            on next sign-in.
          </div>
        </div>
        <div class="set-row__ctrl">
          <button
            type="button"
            class="btn--outline btn--s"
            onclick={clearMasterView}
          >Clear saved view</button>
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .set-hours {
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
  }
  .set-hours .sep {
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .set-codeline {
    font-family: var(--font-mono);
    font-size: 0.95em;
    background: var(--bg-light);
    padding-block: 1px;
    padding-inline: var(--space-xs);
    border-radius: var(--radius-s);
  }
</style>
