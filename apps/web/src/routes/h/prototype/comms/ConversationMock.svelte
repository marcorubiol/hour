<script lang="ts">
  /**
   * Pantalla 1: una conversación de difusión con su historial unificado.
   *
   * Repaso del 2026-10-11 (`research/product/2026-10-11-comms-conversacion-repaso.md`):
   * al abrir una conversación la pregunta es «¿dónde estamos y qué toca?», así
   * que lo primero es la situación (siguiente paso, turno, último contacto,
   * quién la lleva) y, al lado del registro, el trato en juego. El registro y
   * lo que el equipo habla por dentro siguen teniendo las dos lecturas para
   * decidir ADR-099 §5:
   *  - «aparte»: lo hablado con fuera es registro (`conversation_event`) y lo
   *    que el equipo dice por dentro va en su propio hilo, al lado;
   *  - «hilo»: todo en un solo hilo, como ADR-083 §1 al pie de la letra.
   */
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { statusBadgeClass } from '$lib/conversation';
  import { isHoldStatus, performanceStatusTone } from '$lib/performance';
  import {
    MAILBOXES,
    TODAY,
    conversation as c,
    deal,
    record,
    team,
    type Mailbox,
    type RecordEvent,
    type TeamComment,
  } from './data';

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
  let replyFrom = $state<Mailbox>('anouk');
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

  /** El buzón de quien la lleva: el registro solo nombra el buzón cuando es otro. */
  const HOME_MAILBOX: Mailbox = 'anouk';

  const KIND: Record<string, string> = {
    email: 'Correo',
    call: 'Llamada',
    note: 'Nota',
    meeting: 'Reunión',
    message: 'Mensaje',
  };
  function what(e: RecordEvent): string {
    if (e.kind === 'call') return `Llamada ${e.direction === 'inbound' ? 'recibida' : 'hecha'} · ${e.minutes} min`;
    const dir = e.direction === 'inbound' ? 'recibido' : e.direction === 'outbound' ? 'enviado' : '';
    return dir ? `${KIND[e.kind]} ${dir}` : KIND[e.kind];
  }
  function firstLine(body: string | null): string {
    return (body ?? '').split('\n').filter((l) => l.trim() && !/^(hola|buenos)/i.test(l.trim()))[0] ?? '';
  }
  function daysAgo(iso: string): number {
    return Math.round((Date.parse(TODAY) - Date.parse(iso)) / 86_400_000);
  }

  /**
   * El turno se deriva del registro, no se guarda: si lo último con
   * dirección vino de fuera, toca responder; si salió de aquí, se espera.
   */
  let turn = $derived.by(() => {
    const last = record.find((e) => e.direction);
    if (!last) return null;
    const n = daysAgo(last.occurred_at);
    const ago = n === 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} días`;
    return last.direction === 'inbound'
      ? { label: 'Toca responder', note: `su último correo es de ${ago}`, ours: true }
      : { label: 'Esperando respuesta', note: `escribisteis ${ago}`, ours: false };
  });

  let mailboxesUsed = $derived(
    [...new Set(record.map((e) => e.mailbox).filter((m): m is Mailbox => !!m))].map((m) =>
      MAILBOXES[m].label.replace(/^B/, 'b'),
    ),
  );

  type Merged = { at: string; ext?: RecordEvent; int?: TeamComment };
  let merged = $derived<Merged[]>(
    [
      ...record.map((e) => ({ at: e.occurred_at, ext: e })),
      ...team.map((t) => ({ at: t.occurred_at, int: t })),
    ].sort((a, b) => a.at.localeCompare(b.at)),
  );

  const dealHeld = isHoldStatus(deal.status);
</script>

<section class="conv">
  <header class="conv__mast">
    <p class="eyebrow">Conversación · {c.project} · {c.line}</p>
    <h1 class="conv__title"><em>{c.counterpart}</em></h1>
    <p class="conv__sub">
      <span>{c.person}, {c.role.toLowerCase()}</span>
      <span>{c.city}</span>
      <span><span class="badge--xs {statusBadgeClass(c.status)}">{c.statusLabel}</span></span>
      {#if privada}<span class="conv__private">Privada · solo la ves tú</span>{/if}
    </p>
  </header>

  <!-- La situación: lo que se mira antes de leer nada. -->
  <dl class="state">
    <div class="state__cell state__cell--lead">
      <dt>Siguiente paso</dt>
      <dd>{c.nextStep}</dd>
      <dd class="state__note">{c.nextDue} · en 6 días</dd>
    </div>
    {#if turn}
      <div class="state__cell">
        <dt>Turno</dt>
        <dd class:state__ours={turn.ours}>{turn.label}</dd>
        <dd class="state__note">{turn.note}</dd>
      </div>
    {/if}
    <div class="state__cell">
      <dt>Último contacto</dt>
      <dd>{c.lastContact}</dd>
      <dd class="state__note">desde el {c.firstContact}</dd>
    </div>
    <div class="state__cell">
      <dt>La lleva</dt>
      <dd>{c.owner}</dd>
      <dd class="state__note">por su buzón</dd>
    </div>
  </dl>

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
        <p class="block-foot">Entra por {mailboxesUsed.join(' y ')}.</p>
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
      <!-- El trato: el bolo que cuelga de esta conversación (ADR-087). -->
      <section class="side side--deal" aria-labelledby="deal-h">
        <div class="block-head">
          <h2 id="deal-h" class="eyebrow eyebrow--sub">En juego</h2>
          <StateBadge label={deal.statusLabel} tone={performanceStatusTone(deal.status)} />
        </div>
        <p class="deal__title">{deal.title}</p>
        <ul class="days">
          {#each deal.days as d (d.day)}
            <li class="days__row" class:grain={dealHeld}>
              <span class="days__day">{d.day}</span>
              <span class="days__times">{d.times.join(' · ')}</span>
            </li>
          {/each}
        </ul>
        <dl class="kv">
          <div><dt>Caché</dt><dd>{deal.fee} <span class="muted">· {deal.feeNote}</span></dd></div>
          <div><dt>Sala</dt><dd>{deal.venue} <span class="muted">· {deal.capacity}</span></dd></div>
          <div>
            <dt>Enviado</dt>
            <dd>
              {#each deal.sent as s, i (s.label)}<span>{s.label}&nbsp;<span class="muted">{s.when}</span>{i < deal.sent.length - 1 ? ', ' : ''}</span>{/each}
            </dd>
          </div>
        </dl>
      </section>

      {#if reading === 'aparte'}
        <section class="side side--inside" aria-labelledby="inside-h">
          <div class="block-head">
            <h2 id="inside-h" class="eyebrow eyebrow--sub">Por dentro · {team.length}</h2>
          </div>
          <ol class="inside__list">
            {#each [...team].reverse() as t (t.id)}
              <li>{@render comment(t)}</li>
            {/each}
          </ol>
          {@render composer('Escribe al equipo…')}
        </section>
      {/if}

      <section class="side side--who" aria-labelledby="who-h">
        <div class="block-head">
          <h2 id="who-h" class="eyebrow eyebrow--sub">Contacto</h2>
        </div>
        <p class="who__name">{c.person}<span class="muted">, {c.role.toLowerCase()} · {c.counterpartKind.toLowerCase()}</span></p>
        <p class="who__line">{c.email}</p>
        <p class="who__line">{c.phone}</p>
        <p class="who__line muted">{c.consent}.</p>
        <p class="who__note">{c.dossierNote}</p>
        {#each c.sameOrganization as o (o.person)}
          <p class="who__line"><span class="muted">También en {c.counterpart}:</span> {o.person}, {o.role.charAt(0).toLowerCase() + o.role.slice(1)}</p>
        {/each}
      </section>

      <section class="side side--access" aria-labelledby="access-h">
        <div class="privacy__row">
          <h2 id="access-h" class="privacy__label">
            {privada ? 'Solo la ves tú' : `La ven ${c.audience} en MüK Cia`}
          </h2>
          <span class="privacy__switch">
            <span class="muted">Privada</span>
            <button
              type="button"
              class="toggle"
              class:is-on={privada}
              role="switch"
              aria-checked={privada}
              aria-label="Conversación privada"
              onclick={() => (privada = !privada)}
            ><span class="toggle__dot"></span></button>
          </span>
        </div>
        <p class="privacy__hint">
          {privada
            ? 'Para el resto del espacio no existe, tampoco en los recuentos.'
            : 'Todo el que ve conversaciones, con sus correos y lo que se habla por dentro.'}
        </p>
      </section>
    </aside>
  </div>
</section>

{#snippet mailboxNote(e: RecordEvent)}
  {#if e.mailbox && e.mailbox !== HOME_MAILBOX}
    <span class="rec__mb" title={MAILBOXES[e.mailbox].address}>{MAILBOXES[e.mailbox].label.replace(/^B/, 'b')}</span>
  {/if}
{/snippet}

{#snippet attachments(e: RecordEvent)}
  {#if e.attachments?.length}
    <p class="rec__att"><span>Adjuntos</span> {e.attachments.join(', ')}</p>
  {/if}
{/snippet}

{#snippet recordItem(e: RecordEvent)}
  <li class="rec__item" class:rec__item--in={e.direction === 'inbound'}>
    <p class="rec__meta">
      <time class="rec__when" datetime={e.occurred_at}>{e.when}</time>
      <span class="rec__what">{what(e)}</span>
      {@render mailboxNote(e)}
    </p>
    <div class="rec__body">
      {#if e.kind === 'email'}
        <button type="button" class="rec__head" aria-expanded={open.has(e.id)} onclick={() => toggle(e.id)}>
          <span class="rec__subject">{e.subject}</span>
          {#if !open.has(e.id)}<span class="rec__snippet">{firstLine(e.body)}</span>{/if}
        </button>
        {#if !open.has(e.id)}{@render attachments(e)}{/if}
        {#if open.has(e.id)}
          <div class="mail">
            <p class="mail__meta"><span>De</span> {e.from}</p>
            <p class="mail__meta"><span>Para</span> {e.to}</p>
            {#if e.mailbox}<p class="mail__meta"><span>Buzón</span> {MAILBOXES[e.mailbox].label}</p>{/if}
            <p class="mail__text">{e.body}</p>
            {@render attachments(e)}
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
        <p class="rec__note">{e.body}</p>
        <p class="rec__by">{e.by}</p>
      {/if}
    </div>
  </li>
{/snippet}

{#snippet recordCard(e: RecordEvent)}
  <div class="card" class:card--in={e.direction === 'inbound'}>
    <p class="card__head">
      <span class="rec__what">{what(e)}</span>{@render mailboxNote(e)}
      <time class="rec__when" datetime={e.occurred_at}>{e.when}</time>
    </p>
    {#if e.subject}<p class="rec__subject">{e.subject}</p>{/if}
    <p class="rec__snippet">{e.kind === 'email' ? firstLine(e.body) : e.body}</p>
    {@render attachments(e)}
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
      /* La columna de cuándo y qué del registro; en el móvil se pliega. */
      --conv-meta: 8.5rem;

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

    /* La situación: cuatro hechos en fila, sin cajas; filetes arriba y abajo. */
    .state {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--space-s) var(--space-l);
      margin: 0;
      padding-block: var(--space-s);
      border-block: 1px solid var(--border-color-light);
    }
    .state__cell {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .state dt {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .state dd {
      margin: 0;
      color: var(--text-color);
      font-size: var(--text-s);
    }
    .state__cell--lead dd:not(.state__note) {
      color: var(--heading-color);
      font-weight: 500;
    }
    dd.state__ours {
      color: var(--heading-color);
      font-weight: 500;
    }
    .state dd.state__note {
      color: var(--text-faint);
      font-size: var(--text-xs);
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
      grid-template-columns: minmax(0, 1fr) minmax(17rem, 22rem);
      gap: var(--space-xl);
      align-items: start;
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
    .block-foot {
      margin: var(--space-xs) 0 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }

    /* Registro: la columna de la izquierda dice cuándo y qué; la de la
       derecha, lo que se dijo. Todas las filas tienen la misma rejilla, sea
       correo, llamada o nota, así que el ojo baja por una sola línea. */
    .rec {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .rec__item {
      display: grid;
      grid-template-columns: var(--conv-meta) minmax(0, 1fr);
      gap: var(--space-2xs) var(--space-m);
      padding-block: var(--space-s);
      border-block-end: var(--divider);
    }
    .rec__meta {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin: 0;
      padding-block-start: 0.15em;
    }
    .rec__when {
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .rec__what {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    /* Lo que llega de fuera pesa más que lo que salió: es lo que hay que leer. */
    .rec__item--in .rec__what,
    .card--in .rec__what {
      color: var(--heading-color);
      font-weight: 500;
    }
    .rec__mb {
      color: var(--text-faint);
      font-size: var(--text-xs);
      font-style: italic;
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
    .rec__head:hover .rec__subject {
      text-decoration: underline;
      text-decoration-color: var(--border-color-dark);
      text-underline-offset: 0.2em;
    }
    .rec__subject {
      margin: 0;
      color: var(--heading-color);
      font-size: var(--text-s);
      font-weight: 500;
    }
    .rec__item:not(.rec__item--in) .rec__subject {
      font-weight: 400;
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
    .rec__by {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .rec__att {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-xs);
      overflow-wrap: anywhere;
    }
    .rec__att span {
      color: var(--text-faint);
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
      margin: var(--space-s) 0 var(--space-xs);
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

    /* Aside: cuatro bloques con la misma cabecera que el registro. */
    .conv__aside {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }
    .side {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .side p {
      margin: 0;
    }

    .deal__title {
      padding-block-start: var(--space-xs);
      color: var(--heading-color);
      font-family: var(--font-display);
      font-size: var(--text-m);
      font-style: italic;
    }
    /* Las fechas en juego: el grano de la duda es el del Planner
       (`certainty.css`), así una opción se lee igual aquí que en el mes. */
    .days {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .days__row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-s);
      padding: var(--space-xs) var(--space-s);
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-s);
      font-size: var(--text-s);
    }
    .days__day {
      color: var(--heading-color);
    }
    .days__times {
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }

    .kv {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin: var(--space-xs) 0 0;
    }
    .kv > div {
      display: grid;
      grid-template-columns: 4.5rem minmax(0, 1fr);
      gap: var(--space-s);
      align-items: baseline;
    }
    .kv dt {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .kv dd {
      margin: 0;
      font-size: var(--text-s);
    }

    .who__name {
      padding-block-start: var(--space-xs);
      color: var(--heading-color);
      font-size: var(--text-s);
      font-weight: 500;
    }
    .who__name .muted {
      font-weight: 400;
    }
    .who__line {
      font-size: var(--text-xs);
      color: var(--text-muted);
      overflow-wrap: anywhere;
    }
    .side .who__note {
      margin-block: var(--space-2xs);
      padding-inline-start: var(--space-s);
      color: var(--text-color);
      border-inline-start: 2px solid var(--border-color-dark);
      font-size: var(--text-xs);
    }

    .side--access {
      padding-block-start: var(--space-s);
      border-block-start: 1px solid var(--border-color-light);
    }
    .privacy__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
    }
    .privacy__label {
      margin: 0;
      color: var(--heading-color);
      font-family: var(--font-sans);
      font-size: var(--text-s);
      font-weight: 500;
    }
    .privacy__switch {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-xs);
    }
    .privacy__hint {
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

    .inside__list,
    .flow {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .inside__list {
      padding-block: var(--space-xs);
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
    .msg__head time {
      font-family: var(--font-mono);
      letter-spacing: var(--mono-letter-spacing);
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

    /* Una columna: el aside se deshace y cada bloque toma su sitio por
       importancia. El trato sube encima del registro; el contacto y quién
       la ve bajan al final. */
    @media (max-width: 63.999rem) {
      .conv__grid {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-l);
      }
      .conv__aside {
        display: contents;
      }
      .side--deal {
        order: -1;
      }
      .side--inside {
        order: 1;
      }
      .side--who {
        order: 2;
      }
      .side--access {
        order: 3;
      }
    }

    @media (max-width: 47.999rem) {
      .conv {
        --conv-meta: auto;
      }
      .rec__item {
        grid-template-columns: minmax(0, 1fr);
      }
      .rec__meta {
        flex-direction: row;
        flex-wrap: wrap;
        gap: var(--space-xs);
      }
      .rec__meta > * + *::before {
        content: '·';
        margin-inline-end: var(--space-xs);
        color: var(--text-faint);
      }
      .state {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .card {
        margin-inline-start: 0;
      }
    }
  }
</style>
