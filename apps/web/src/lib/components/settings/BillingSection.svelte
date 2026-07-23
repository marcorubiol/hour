<script lang="ts">
  import { session } from '$lib/session.svelte';

  let userEmail = $derived(session.user?.email ?? '');
</script>

<header class="set-mast">
  <p class="eyebrow set-mast__kicker">Money</p>
  <h1 class="set-mast__title"><em>Billing</em></h1>
  <p class="set-mast__sub">
    Hour is a small Barcelona-based tool. Your money goes a long way here.
  </p>
</header>

<section class="set-group">
  <div class="set-group__body">
    <div class="set-plan">
      <div class="set-plan__head">
        <span class="eyebrow set-plan__kicker">Current plan</span>
        <h2 class="set-plan__name">
          Solo <em>·</em> <span>€9/mo</span>
        </h2>
        <p class="set-plan__sub">
          All features, unlimited projects, one person. Next billing 1
          May 2026.
        </p>
      </div>
      <div class="set-plan__actions">
        <button type="button" class="btn--primary btn--s">
          Switch to yearly · save 20%
        </button>
        <button type="button" class="btn--outline btn--s">
          Upgrade to Collective (€19/mo, up to 6 people)
        </button>
        <button type="button" class="btn--outline btn--s is-warn">Cancel plan</button>
      </div>
    </div>
  </div>
</section>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">Payment</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Method</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-card">
          <span class="set-card__brand">VISA</span>
          <span>•••• 4242</span>
          <span class="set-row__hint">exp 11/27</span>
          <button type="button" class="btn--outline btn--s">Update</button>
        </div>
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Billing email</div>
        <div class="set-row__hint">Receipts and VAT documents.</div>
      </div>
      <div class="set-row__ctrl">
        <input  type="email" value={userEmail} readonly />
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Tax ID</div>
        <div class="set-row__hint">ES NIF / EU VAT — for proper invoices.</div>
      </div>
      <div class="set-row__ctrl">
        <input class="input--short" type="text" value="ES 41XXXXXXX-A" />
      </div>
    </div>
  </div>
</section>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">History</span>
  </div>
  <div class="set-group__body">
    <div class="set-invoices">
      {#each ['2026-04-01', '2026-03-01', '2026-02-01', '2026-01-01'] as d (d)}
        <div class="set-invoice">
          <span class="set-invoice__date">{d}</span>
          <span class="set-invoice__plan">Solo · monthly</span>
          <span class="set-invoice__amt">€9.00</span>
          <span class="set-invoice__status">paid</span>
          <button type="button" class="btn--outline btn--s">PDF</button>
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .set-plan {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-m);
    padding: var(--space-m);
    border: 1px solid var(--border-color-light);
    border-radius: var(--radius);
    background: var(--bg-light);
  }
  .set-plan__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  /* Kicker typography via base.css .eyebrow. */

  .set-plan__name {
    font-family: var(--font-display);
    font-size: var(--text-xxl);
    font-weight: 400;
    letter-spacing: -0.02em;
    margin: 0;
    color: var(--text-color);
  }
  .set-plan__name em {
    font-style: italic;
    color: var(--text-muted);
  }
  .set-plan__name span {
    font-size: var(--text-xl);
    color: var(--text-muted);
  }
  .set-plan__sub {
    font-size: var(--text-s);
    color: var(--text-muted);
    margin: var(--space-xs) 0 0;
    line-height: 1.55;
  }
  .set-plan__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    align-items: flex-end;
  }
  .set-plan__actions button {
    white-space: nowrap;
  }

  .set-card {
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
    font-size: var(--text-s);
    color: var(--text-color);
  }
  .set-card__brand {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.1em;
    background: var(--text-color);
    color: var(--bg);
    padding-block: 3px;
    padding-inline: var(--space-s);
    border-radius: var(--radius-s);
  }

  .set-invoices {
    display: flex;
    flex-direction: column;
  }
  .set-invoice {
    display: grid;
    grid-template-columns: 100px 1fr auto auto auto;
    gap: var(--space-m);
    align-items: center;
    padding-block: var(--space-s);
    border-block-end: 1px solid var(--border-color-light);
    font-size: var(--text-s);
  }
  .set-invoice:last-child {
    border-block-end: 0;
  }
  .set-invoice__date {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    letter-spacing: 0.04em;
  }
  .set-invoice__plan {
    color: var(--text-color);
  }
  .set-invoice__amt {
    font-family: var(--font-mono);
    color: var(--text-color);
    font-weight: 500;
  }
  .set-invoice__status {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--success);
    border: 1px solid currentColor;
    padding-block: 2px;
    padding-inline: var(--space-s);
    border-radius: var(--radius-s);
  }
</style>
