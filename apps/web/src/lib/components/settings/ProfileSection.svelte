<script lang="ts">
  import { onMount } from 'svelte';
  import { accentVar } from '$lib/utils/accent';
  import { session } from '$lib/session.svelte';

  let { workspaceSlug }: { workspaceSlug: string } = $props();

  // ─── identity from session ────────────────────────────────────────────
  let userEmail = $derived(session.user?.email ?? '');
  let userName = $state('Marco Rubiol');

  onMount(() => {
    const name = session.user?.name;
    if (name) userName = name;
  });

  let initials = $derived(
    userName
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || 'MR',
  );
</script>

<header class="set-mast">
  <p class="eyebrow set-mast__kicker">Account</p>
  <h1 class="set-mast__title"><em>Profile</em></h1>
  <p class="set-mast__sub">
    The basics. Used across your projects and on press kits.
  </p>
</header>

<section class="set-group">
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Avatar</div>
        <div class="set-row__hint">A monogram for now. Drop an image later.</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-avatar-pick">
          <span
            class="set-avatar-pick__big"
            style={`background: ${accentVar(workspaceSlug)}`}
          >
            {initials}
          </span>
          <button type="button" class="btn--primary btn--s">Upload image</button>
          <span class="set-row__hint">PNG, square, ≥ 256px</span>
        </div>
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Full name</div>
        <div class="set-row__hint">Used on invoices and contracts.</div>
      </div>
      <div class="set-row__ctrl">
        <input type="text" bind:value={userName} />
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Email</div>
        <div class="set-row__hint">Sign-in and project invitations.</div>
      </div>
      <div class="set-row__ctrl">
        <input type="email" bind:value={userEmail} readonly />
      </div>
    </div>
  </div>
</section>

<!-- LOCATION & TIMEZONE group killed: timezone derives from
     browser automatically, week-starts-on default to Monday is
     fine for Phase 0, location adds nothing operational.
     Pronouns and Display name killed too (Phase 0 reality:
     solo Marco; pronouns opens a debate we don't need to host). -->

<style>
  .set-avatar-pick {
    display: inline-flex;
    align-items: center;
    gap: var(--space-m);
    flex-wrap: wrap;
  }
  .set-avatar-pick__big {
    inline-size: 56px;
    block-size: 56px;
    border-radius: 50%;
    color: var(--bg);
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: var(--text-l);
    font-weight: 600;
    flex: none;
  }
</style>
