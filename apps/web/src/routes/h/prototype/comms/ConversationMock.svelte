<script lang="ts">
  /**
   * Pantalla 1: una conversación de difusión con su historial unificado.
   * Dos lecturas para decidir ADR-099 §5:
   *  - «aparte»: lo hablado con fuera es registro (`conversation_event`) y lo
   *    que el equipo dice por dentro va en su propio hilo, al lado;
   *  - «hilo»: todo en un solo hilo, como ADR-083 §1 al pie de la letra.
   */
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Avatar from '$lib/components/Avatar.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import Button from '$lib/components/Button.svelte';
  import { MAILBOXES, conversation as c, record, team, type RecordEvent, type TeamComment } from './data';

  type Reading = 'aparte' | 'hilo';
  let reading = $derived<Reading>(page.url.searchParams.get('lectura') === 'hilo' ? 'hilo' : 'aparte');
  function setReading(r: Reading) {
    const url = new URL(page.url);
    url.searchParams.set('lectura', r);
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
  }

  let privada = $state(false);
  let open = $state<Set<string>>(new Set(['e7']));
  let replyTo = $state<string | null>(null);
  let replyFrom = $state<'anouk' | 'comun'>('anouk');
  let sentNote = $state(false);

  function toggle(id: string) {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    open = next;
  }
  function reply(e: RecordEvent) {
    replyTo = e.id;
    replyFrom = e.mailbox ?? 'anouk';
    sentNote = false;
    open = new Set(open).add(e.id);
  }

  const KIND: Record<string, string> = {
    email: 'Correo',
    call: 'Llamada',
    note: 'Nota',
    meeting: 'Reunión',
    message: 'Mensaje',
  };
  function what(e: RecordEvent): string {
    const dir = e.direction === 'inbound' ? 'recibido' : e.direction === 'outbound' ? 'enviado' : '';
    if (e.kind === 'call') return `Llamada ${e.direction === 'inbound' ? 'recibida' : 'hecha'} · ${e.minutes} min`;
    return dir ? `${KIND[e.kind]} ${dir}` : KIND[e.kind];
  }
  function firstLine(body: string | null): string {
    return (body ?? '').split('\n').filter((l) => l.trim() && !/^(hola|buenos)/i.test(l.trim()))[0] ?? '';
  }

  type Merged = { at: string; ext?: RecordEvent; int?: TeamComment };
  let merged = $derived<Merged[]>(
    [
      ...record.map((e) => ({ at: e.occurred_at, ext: e })),
      ...team.map((t) => ({ at: t.occurred_at, int: t })),
    ].sort((a, b) => a.at.localeCompare(b.at)),
  );
</script>

<section class="conv">
  <header class="conv__mast">
    <p class="eyebrow">Conversación · {c.project} · {c.line}</p>
    <h1 class="conv__title"><em>{c.counterpart}</em></h1>
    <p class="conv__sub">
      <span>{c.person}, {c.role.toLowerCase()}</span>
      <span>{c.city}</span>
      <span><Badge size="xs" tone="warning">{c.status}</Badge></span>
      {#if privada}<span class="conv__private">Privada · solo la ves tú</span>{/if}
    </p>
  </header>

  <div class="conv__bar">
    <div class="seg" role="group" aria-label="Lectura">
      <button type="button" class:is-on={reading === 'aparte'} aria-pressed={reading === 'aparte'} onclick={() => setReading('aparte')}>
        Registro y equipo aparte
      </button>
      <button type="button" class:is-on={reading === 'hilo'} aria-pressed={reading === 'hilo'} onclick={() => setReading('hilo')}>
        Todo en un hilo
      </button>
    </div>
    <span class="conv__hint">
      {reading === 'aparte'
        ? 'ADR-099 §5: lo hablado con fuera es registro; el equipo habla por dentro, al lado.'
        : 'ADR-083 §1 al pie de la letra: correos, llamadas y equipo en una sola línea.'}
    </span>
  </div>

  <div class="conv__grid" class:conv__grid--single={reading === 'hilo'}>
    <div class="conv__main">
      {#if reading === 'aparte'}
        <div class="block-head">
          <h2 class="eyebrow eyebrow--sub">Con fuera · {record.length}</h2>
          <Button size="xs" variant="outline">Escribir correo</Button>
        </div>
        <ol class="rec" aria-label="Registro">
          {#each record as e (e.id)}
            {@render recordItem(e)}
          {/each}
        </ol>
      {:else}
        <div class="block-head">
          <h2 class="eyebrow eyebrow--sub">Hilo · {merged.length}</h2>
        </div>
        <ol class="flow" aria-label="Hilo">
          {#each merged as m (m.ext?.id ?? m.int?.id)}
            {#if m.ext}
              <li class="flow__ext">{@render recordCard(m.ext)}</li>
            {:else if m.int}
              <li class="flow__int">{@render comment(m.int)}</li>
            {/if}
          {/each}
        </ol>
        {@render composer('Escribe al equipo o responde…')}
      {/if}
    </div>

    <aside class="conv__aside">
      <dl class="facts">
        <div><dt>Último contacto</dt><dd>{c.lastContact}</dd></div>
        <div><dt>Siguiente paso</dt><dd>{c.nextStep} <span class="muted">· {c.nextDue}</span></dd></div>
        <div><dt>Lleva</dt><dd>{c.owner}</dd></div>
      </dl>

      <div class="privacy">
        <div class="privacy__row">
          <span class="privacy__label">Conversación privada</span>
          <button
            type="button"
            class="toggle"
            class:is-on={privada}
            role="switch"
            aria-checked={privada}
            aria-label="Conversación privada"
            onclick={() => (privada = !privada)}
          ><span class="toggle__dot"></span></button>
        </div>
        <p class="privacy__hint">
          {privada
            ? 'Solo la ves tú. Para el resto del espacio no existe, tampoco en los recuentos.'
            : 'La ve todo el que ve conversaciones en MüK Cia, con sus correos.'}
        </p>
      </div>

      <div class="legend">
        <p class="eyebrow eyebrow--sub">Buzones que traen correo aquí</p>
        {#each Object.entries(MAILBOXES) as [key, mb] (key)}
          <p class="legend__row"><span class="mb mb--{key}">{mb.label}</span><span class="muted">{mb.address}</span></p>
        {/each}
      </div>

      {#if reading === 'aparte'}
        <div class="inside">
          <div class="block-head">
            <h2 class="eyebrow eyebrow--sub">Por dentro · equipo</h2>
          </div>
          <p class="inside__aud">Lo ven 3, por ver esta conversación</p>
          <ol class="inside__list">
            {#each [...team].reverse() as t (t.id)}
              <li>{@render comment(t)}</li>
            {/each}
          </ol>
          {@render composer('Escribe al equipo…')}
        </div>
      {/if}
    </aside>
  </div>
</section>

{#snippet mailbox(e: RecordEvent)}
  {#if e.mailbox}
    <span class="mb mb--{e.mailbox}" title={MAILBOXES[e.mailbox].address}>vía {MAILBOXES[e.mailbox].label.replace(/^B/, 'b')}</span>
  {/if}
{/snippet}

{#snippet recordItem(e: RecordEvent)}
  <li class="rec__item" class:rec__item--in={e.direction === 'inbound'}>
    <time class="rec__when" datetime={e.occurred_at}>{e.when}</time>
    <div class="rec__body">
      {#if e.kind === 'email'}
        <button type="button" class="rec__head" aria-expanded={open.has(e.id)} onclick={() => toggle(e.id)}>
          <span class="rec__what">{what(e)}{@render mailbox(e)}</span>
          <span class="rec__subject">{e.subject}</span>
          {#if !open.has(e.id)}<span class="rec__snippet">{firstLine(e.body)}</span>{/if}
        </button>
        {#if open.has(e.id)}
          <div class="mail">
            <p class="mail__meta"><span>De</span> {e.from}</p>
            <p class="mail__meta"><span>Para</span> {e.to}</p>
            <p class="mail__text">{e.body}</p>
            {#if replyTo !== e.id}
              <div class="mail__actions">
                <Button size="xs" variant="outline" onclick={() => reply(e)}>Responder</Button>
              </div>
            {:else}
              {@render replyBox(e)}
            {/if}
          </div>
        {/if}
      {:else}
        <span class="rec__what">{what(e)} <span class="muted">· {e.by}</span></span>
        <p class="rec__note">{e.body}</p>
      {/if}
    </div>
  </li>
{/snippet}

{#snippet recordCard(e: RecordEvent)}
  <div class="card" class:card--in={e.direction === 'inbound'}>
    <p class="card__head">
      <span class="rec__what">{what(e)}</span>{@render mailbox(e)}
      <time class="rec__when" datetime={e.occurred_at}>{e.when}</time>
    </p>
    {#if e.subject}<p class="rec__subject">{e.subject}</p>{/if}
    <p class="rec__snippet">{e.kind === 'email' ? firstLine(e.body) : e.body}</p>
  </div>
{/snippet}

{#snippet comment(t: TeamComment)}
  <div class="msg">
    <Avatar size="xs" name={t.by} tone="neutral" />
    <div>
      <p class="msg__head"><span class="msg__by">{t.by}</span> <time datetime={t.occurred_at}>{t.when}</time></p>
      <p class="msg__text">{t.body}</p>
    </div>
  </div>
{/snippet}

{#snippet composer(placeholder: string)}
  <div class="compose">
    <textarea rows="2" {placeholder} aria-label={placeholder}></textarea>
    <div class="compose__row">
      <span class="muted">Solo el equipo. No sale de Hour.</span>
      <Button size="xs">Publicar</Button>
    </div>
  </div>
{/snippet}

{#snippet replyBox(e: RecordEvent)}
  <form class="reply" onsubmit={(ev) => { ev.preventDefault(); sentNote = true; }}>
    <label class="reply__field">
      <span>Desde</span>
      <select bind:value={replyFrom}>
        <option value="anouk">{MAILBOXES.anouk.address} · tu buzón ({MAILBOXES.anouk.provider})</option>
        <option value="comun">{MAILBOXES.comun.address} · buzón común</option>
      </select>
    </label>
    <p class="reply__field"><span>Para</span> {e.from}</p>
    <p class="reply__field"><span>Asunto</span> {e.subject?.startsWith('Re:') ? e.subject : `Re: ${e.subject}`}</p>
    <textarea rows="4" aria-label="Respuesta">Hola, Inés:

Perfecto. Te paso el rider simplificado hoy mismo.</textarea>
    <p class="reply__sig">Anouk Delmas<br />Producción · MüK Cia</p>
    <div class="reply__row">
      <span class="muted">
        {sentNote
          ? 'Maqueta: no se envía nada.'
          : `Sale de ${MAILBOXES[replyFrom].address}, con su firma, y queda en el registro.`}
      </span>
      <span class="reply__btns">
        <Button size="xs" variant="outline" onclick={() => (replyTo = null)}>Descartar</Button>
        <Button size="xs" type="submit">Enviar</Button>
      </span>
    </div>
  </form>
{/snippet}

<style>
  @layer components {
    .conv {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .conv__mast {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .conv__title {
      margin: 0;
    }
    .conv__sub {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs) var(--space-s);
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .conv__sub > * + *::before {
      content: '·';
      margin-inline-end: var(--space-s);
      color: var(--text-faint);
    }
    .conv__private {
      color: var(--heading-color);
      font-weight: 500;
    }

    .conv__bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-s) var(--space-m);
    }
    .conv__hint {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }

    .seg {
      display: inline-flex;
      padding: 2px;
      background: var(--bg-light);
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius);
    }
    .seg button {
      appearance: none;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      color: var(--text-muted);
      background: transparent;
      border: 0;
      border-radius: var(--radius-s);
      font: inherit;
      font-size: var(--text-xs);
      cursor: pointer;
    }
    .seg button.is-on {
      color: var(--text-color);
      background: var(--bg-ultra-light);
      box-shadow: var(--box-shadow-1);
      font-weight: 500;
    }

    .conv__grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
      gap: var(--space-xl);
      align-items: start;
    }
    @media (max-width: 63.999rem) {
      .conv__grid {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-l);
      }
    }

    .block-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
      min-block-size: var(--control-size-s);
      padding-block-end: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }
    .block-head h2 {
      margin: 0;
    }

    /* Registro: misma rejilla que ConversationHistory (fecha | qué). */
    .rec {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .rec__item {
      display: grid;
      grid-template-columns: 7.5rem minmax(0, 1fr);
      gap: var(--space-2xs) var(--space-s);
      padding-block: var(--space-s);
      border-block-end: var(--divider);
    }
    .rec__when {
      padding-block-start: 0.1em;
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .rec__body {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .rec__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      padding: 0;
      color: inherit;
      text-align: start;
      background: none;
      border: 0;
      font: inherit;
      cursor: pointer;
    }
    .rec__what {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      color: var(--text-dark-muted);
      font-size: var(--text-xs);
    }
    .rec__item--in .rec__what {
      color: var(--heading-color);
    }
    .rec__subject {
      margin: 0;
      color: var(--heading-color);
      font-size: var(--text-s);
      font-weight: 500;
    }
    .rec__snippet {
      margin: 0;
      overflow: hidden;
      color: var(--text-muted);
      font-size: var(--text-s);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rec__note {
      margin: 0;
      color: var(--text-color);
      font-size: var(--text-s);
    }

    /* El buzón que trajo el correo: una marca, no un color nuevo. */
    .mb {
      padding-inline: var(--space-xs);
      color: var(--text-dark-muted);
      background: var(--tag-neutral-bg);
      border-radius: var(--radius-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .mb--comun {
      color: var(--tag-blue-fg);
      background: var(--tag-blue-bg);
    }

    .mail {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin-block-start: var(--space-xs);
      padding: var(--space-s) var(--space-m);
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius);
    }
    .mail__meta {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-xs);
      overflow-wrap: anywhere;
    }
    .mail__meta span,
    .reply__field > span {
      display: inline-block;
      min-inline-size: 3.5rem;
      color: var(--text-faint);
    }
    .mail__text {
      margin: var(--space-s) 0 0;
      font-size: var(--text-s);
      white-space: pre-line;
    }
    .mail__actions {
      display: flex;
      justify-content: flex-end;
      margin-block-start: var(--space-s);
    }

    .reply {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin-block-start: var(--space-s);
      padding-block-start: var(--space-s);
      border-block-start: 1px solid var(--border-color-light);
    }
    .reply__field {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-xs);
      overflow-wrap: anywhere;
    }
    .reply__field select {
      min-inline-size: 0;
      max-inline-size: 100%;
      padding: var(--space-2xs) var(--space-xs);
      color: var(--text-color);
      background: var(--bg-light);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-s);
      font: inherit;
    }
    .reply textarea,
    .compose textarea {
      inline-size: 100%;
      padding: var(--space-xs) var(--space-s);
      color: var(--text-color);
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-s);
      font: inherit;
      font-size: var(--text-s);
      resize: vertical;
    }
    .reply__sig {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .reply__row,
    .compose__row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-xs) var(--space-s);
      font-size: var(--text-xs);
    }
    .reply__btns {
      display: inline-flex;
      gap: var(--space-xs);
    }

    .muted {
      color: var(--text-faint);
    }

    /* Aside */
    .conv__aside {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }
    .facts {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      margin: 0;
    }
    .facts dt {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .facts dd {
      margin: 0;
      font-size: var(--text-s);
    }
    .privacy {
      padding-block: var(--space-s);
      border-block: 1px solid var(--border-color-light);
    }
    .privacy__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
    }
    .privacy__label {
      font-size: var(--text-s);
      font-weight: 500;
    }
    .privacy__hint {
      margin: var(--space-xs) 0 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      inline-size: 36px;
      block-size: 20px;
      padding: 2px;
      background: var(--border-color-dark);
      border: 0;
      border-radius: var(--radius-circle);
      cursor: pointer;
      transition: background var(--transition);
    }
    .toggle__dot {
      inline-size: 16px;
      block-size: 16px;
      background: var(--bg-ultra-light);
      border-radius: 50%;
      box-shadow: var(--box-shadow-1);
      transition: transform var(--transition);
    }
    .toggle.is-on {
      background: var(--text-color);
    }
    .toggle.is-on .toggle__dot {
      transform: translateX(16px);
    }

    .legend {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .legend p {
      margin: 0;
    }
    .legend__row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      font-size: var(--text-xs);
    }

    .inside {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    .inside__aud {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .inside__list,
    .flow {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .flow {
      padding-block: var(--space-m);
    }

    .msg {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--space-s);
      align-items: start;
    }
    .msg p {
      margin: 0;
    }
    .msg__head {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .msg__by {
      color: var(--heading-color);
      font-weight: 500;
    }
    .msg__text {
      font-size: var(--text-s);
    }

    .card {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin-inline-start: calc(var(--space-s) + 1.5rem);
      padding: var(--space-s) var(--space-m);
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-light);
      border-inline-start: 2px solid var(--border-color-dark);
      border-radius: var(--radius);
    }
    .card p {
      margin: 0;
    }
    .card__head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
    }
    .card__head .rec__when {
      margin-inline-start: auto;
    }
    .card .rec__snippet {
      white-space: normal;
    }

    .compose {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    @media (max-width: 47.999rem) {
      .rec__item {
        grid-template-columns: minmax(0, 1fr);
      }
      .card {
        margin-inline-start: 0;
      }
    }
  }
</style>
