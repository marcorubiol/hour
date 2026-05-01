<script lang="ts">
  import Button from '../components/Button.svelte';
  import LinkButton from '../components/LinkButton.svelte';
  import Input from '../components/Input.svelte';
  import Checkbox from '../components/Checkbox.svelte';
  import Radio from '../components/Radio.svelte';

  let counter = $state(0);
  let asyncLoading = $state(false);
  let liveText = $state('');
  let priceValue = $state('');
  let agreeChecked = $state(false);
  let selectedColor = $state('primary');

  async function fakeAsync() {
    asyncLoading = true;
    await new Promise((r) => setTimeout(r, 1200));
    asyncLoading = false;
  }
</script>

<main class="playground">
  <header class="playground__header">
    <h1>Component Playground</h1>
    <p class="text--s text--dark-muted">
      Dev-only. Hot reload from <code>src/components/</code>.
    </p>
  </header>

  <section class="playground__section">
    <h2 class="h3">Button — variants</h2>
    <div class="playground__row">
      <Button variant="primary">Primary</Button>
      <Button variant="outline">Outline</Button>
    </div>
  </section>

  <section class="playground__section">
    <h2 class="h3">Button — sizes</h2>
    <div class="playground__row">
      <Button size="xs">XS</Button>
      <Button size="s">S</Button>
      <Button size="m">M (default)</Button>
      <Button size="l">L</Button>
    </div>
    <div class="playground__row">
      <Button variant="outline" size="xs">XS</Button>
      <Button variant="outline" size="s">S</Button>
      <Button variant="outline" size="m">M</Button>
      <Button variant="outline" size="l">L</Button>
    </div>
  </section>

  <section class="playground__section">
    <h2 class="h3">Button — states</h2>
    <div class="playground__row">
      <Button>Default</Button>
      <Button disabled>Disabled</Button>
      <Button loading>Loading</Button>
      <Button variant="outline" disabled>Disabled outline</Button>
      <Button variant="outline" loading>Loading outline</Button>
    </div>
  </section>

  <section class="playground__section">
    <h2 class="h3">Button — snippets (lead, tail)</h2>
    <div class="playground__row">
      <Button>
        {#snippet lead()}<span aria-hidden="true">←</span>{/snippet}
        Back
      </Button>
      <Button>
        Continue
        {#snippet tail()}<span aria-hidden="true">→</span>{/snippet}
      </Button>
      <Button variant="outline">
        {#snippet lead()}<span aria-hidden="true">+</span>{/snippet}
        Add item
      </Button>
      <Button variant="outline">
        Filter
        {#snippet tail()}<span aria-hidden="true">▾</span>{/snippet}
      </Button>
    </div>
  </section>

  <section class="playground__section">
    <h2 class="h3">Button — interactive</h2>
    <div class="playground__row">
      <Button onclick={() => counter++}>Click ({counter})</Button>
      <Button variant="outline" onclick={() => (counter = 0)}>Reset</Button>
      <Button loading={asyncLoading} onclick={fakeAsync}>
        Async (1.2s)
      </Button>
    </div>
  </section>

  <section class="playground__section">
    <h2 class="h3">LinkButton</h2>
    <div class="playground__row">
      <LinkButton href="/login">Internal</LinkButton>
      <LinkButton href="https://astro.build" target="_blank" variant="outline">
        External
        {#snippet tail()}<span aria-hidden="true">↗</span>{/snippet}
      </LinkButton>
      <LinkButton href="/booking">Booking</LinkButton>
    </div>
  </section>

  <section class="playground__section">
    <h2 class="h3">Input — basics</h2>
    <Input label="Email" name="email" type="email" placeholder="you@hour.com" />
    <Input
      label="Password"
      name="password"
      type="password"
      placeholder="••••••••"
      required
    />
    <Input
      label="Search"
      name="search"
      type="search"
      placeholder="Search engagements..."
    />
  </section>

  <section class="playground__section">
    <h2 class="h3">Input — states</h2>
    <Input label="Default" placeholder="Type something" />
    <Input
      label="With helper"
      placeholder="..."
      helper="Lowercase letters and dashes only."
    />
    <Input
      label="With error"
      placeholder="..."
      value="invalid email"
      error="Email format is invalid."
    />
    <Input
      label="Disabled"
      placeholder="Cannot edit"
      disabled
      value="locked content"
    />
    <Input label="Loading" placeholder="Checking availability..." loading />
  </section>

  <section class="playground__section">
    <h2 class="h3">Input — prefix / suffix</h2>
    <Input label="Price" type="number" placeholder="0" bind:value={priceValue}>
      {#snippet prefix()}€{/snippet}
      {#snippet suffix()}/mo{/snippet}
    </Input>
    <Input label="URL slug" placeholder="my-show">
      {#snippet prefix()}hour.zerosense.studio/h/marco-rubiol/{/snippet}
    </Input>
    <Input label="Search" type="search" placeholder="Find a person...">
      {#snippet prefix()}<span aria-hidden="true">⌕</span>{/snippet}
    </Input>
  </section>

  <section class="playground__section">
    <h2 class="h3">Input — interactive (bind)</h2>
    <Input label="Live value" bind:value={liveText} placeholder="Type here" />
    <p class="text--s text--dark-muted">
      Current value: <code>{liveText || '(empty)'}</code>
    </p>
  </section>

  <section class="playground__section">
    <h2 class="h3">Checkbox — basics</h2>
    <Checkbox label="I accept the terms" />
    <Checkbox label="Send me updates" checked />
    <Checkbox label="Indeterminate (e.g. select all)" indeterminate />
    <Checkbox label="Disabled" disabled />
    <Checkbox label="Disabled checked" disabled checked />
  </section>

  <section class="playground__section">
    <h2 class="h3">Checkbox — with helper / error</h2>
    <Checkbox
      label="Enable two-factor auth"
      helper="Recommended for security."
    />
    <Checkbox
      label="I accept the terms"
      error="You must accept to continue."
    />
  </section>

  <section class="playground__section">
    <h2 class="h3">Checkbox — interactive (bind)</h2>
    <Checkbox label="Toggle me" bind:checked={agreeChecked} />
    <p class="text--s text--dark-muted">
      Status: <code>{agreeChecked ? 'on' : 'off'}</code>
    </p>
  </section>

  <section class="playground__section">
    <h2 class="h3">Radio — group</h2>
    <Radio
      name="palette"
      value="primary"
      label="Primary"
      bind:group={selectedColor}
    />
    <Radio
      name="palette"
      value="success"
      label="Success"
      bind:group={selectedColor}
    />
    <Radio
      name="palette"
      value="warning"
      label="Warning"
      bind:group={selectedColor}
    />
    <Radio
      name="palette"
      value="danger"
      label="Danger"
      bind:group={selectedColor}
      disabled
    />
    <p class="text--s text--dark-muted">
      Selected: <code>{selectedColor}</code>
    </p>
  </section>

  <section class="playground__section">
    <h2 class="h3">As form submit</h2>
    <form
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        counter += 10;
      }}
    >
      <input type="text" placeholder="Type something" />
      <Button type="submit" variant="primary">Submit (+10)</Button>
    </form>
  </section>
</main>

<style>
  @layer components {
    .playground {
      padding: var(--space-l);
      max-inline-size: var(--content-width);
      margin-inline: auto;
      display: flex;
      flex-direction: column;
      gap: var(--space-xl);
    }
    .playground__header {
      padding-block-end: var(--space-m);
      border-block-end: var(--divider);
    }
    .playground__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    .playground__row {
      display: flex;
      gap: var(--space-s);
      align-items: center;
      flex-wrap: wrap;
    }
  }
</style>
