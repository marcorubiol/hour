<script lang="ts">
  /**
   * Pantalla 2: ajustes de buzones (ADR-099 §2, §3, §9). El personal sale
   * sin conectar para enseñar la elección; el común, ya conectado por un admin.
   */
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import { MAILBOXES } from './data';

  type Provider = 'google' | 'microsoft' | 'otro';
  let personal = $state<Provider | null>(null);
  let other = $state(false);

  function connect(p: Provider) {
    if (p === 'otro') {
      other = !other;
      return;
    }
    personal = p;
    other = false;
  }
</script>

<section class="mb-page">
  <header class="mast">
    <p class="eyebrow">Ajustes · MüK Cia</p>
    <h1 class="mast__title"><em>Buzones</em></h1>
    <p class="mast__sub">
      Hour lee y envía por tu correo. Lo que mandas y recibes de tus contactos de Hour aparece en su conversación;
      lo que respondes desde Hour sale de tu buzón, con tu dirección y tu firma.
    </p>
  </header>

  <section class="group">
    <div class="group__head"><span class="eyebrow">Qué lee Hour</span></div>
    <div class="reads">
      <div>
        <p class="reads__k">Entra</p>
        <p>Los correos enviados y recibidos con una dirección que ya está en un contacto de Hour. Se emparejan por dirección exacta.</p>
      </div>
      <div>
        <p class="reads__k">No entra</p>
        <p>Todo lo demás. El resto del buzón no se lee ni se guarda.</p>
      </div>
      <div>
        <p class="reads__k">Quién lo ve</p>
        <p>Quien ve la conversación en el espacio. Si la marcas privada, solo tú.</p>
      </div>
    </div>
  </section>

  <section class="group">
    <div class="group__head">
      <span class="eyebrow">Tu buzón</span>
    </div>

    <div class="row">
      <div class="row__lead">
        <div class="row__label">Buzón personal</div>
        <div class="row__hint">Solo lo usas tú para enviar. Lo que traiga lo ve quien vea esa conversación.</div>
      </div>
      <div class="row__ctrl">
        {#if personal}
          <div class="conn">
            <p class="conn__addr">{MAILBOXES.anouk.address}</p>
            <p class="conn__meta">
              {personal === 'google' ? 'Google' : 'Microsoft 365'} · conectado ahora · leyendo desde el 1 de septiembre
            </p>
            <p class="conn__meta">0 correos de 154 contactos todavía. La primera sincronización tarda unos minutos.</p>
          </div>
          <Button size="s" variant="outline" tone="warn" onclick={() => (personal = null)}>Desconectar</Button>
        {:else}
          <div class="providers">
            <Button size="s" variant="outline" onclick={() => connect('google')}>Conectar con Google</Button>
            <Button size="s" variant="outline" onclick={() => connect('microsoft')}>Conectar con Microsoft</Button>
            <Button size="s" variant="outline" onclick={() => connect('otro')}>Otro (IMAP y SMTP)</Button>
          </div>
          {#if other}
            <div class="imap">
              <Input label="Correo" value="anouk@mukcia.com" />
              <Input label="Servidor IMAP" value="imap.mukcia.com" />
              <Input label="Servidor SMTP" value="smtp.mukcia.com" />
              <Input label="Contraseña de aplicación" type="password" placeholder="La de tu proveedor, no la de Hour" />
              <div class="imap__go"><Button size="s" onclick={() => connect('google')}>Conectar</Button></div>
            </div>
          {/if}
        {/if}
      </div>
    </div>

    <div class="row">
      <div class="row__lead">
        <div class="row__label">Firma</div>
        <div class="row__hint">Va al pie de lo que envías desde Hour. Se toma de tu buzón al conectarlo.</div>
      </div>
      <div class="row__ctrl">
        <p class="sig">Anouk Delmas<br />Producción · MüK Cia<br />+34 600 000 000</p>
      </div>
    </div>
  </section>

  <section class="group">
    <div class="group__head">
      <span class="eyebrow">Buzón común del espacio</span>
      <span class="admin">Lo conecta un admin</span>
    </div>

    <div class="row">
      <div class="row__lead">
        <div class="row__label">Buzón de difusión</div>
        <div class="row__hint">Lo comparte el equipo: lo que traiga aparece en la conversación del contacto, igual que el personal.</div>
      </div>
      <div class="row__ctrl">
        <div class="conn">
          <p class="conn__addr">{MAILBOXES.comun.address}</p>
          <p class="conn__meta">{MAILBOXES.comun.provider} · conectado por Marco Rubiol el 3 oct · última lectura hace 4 min</p>
          <p class="conn__meta">212 correos emparejados con 61 conversaciones.</p>
        </div>
        <Button size="s" variant="outline">Cambiar</Button>
      </div>
    </div>

    <div class="row">
      <div class="row__lead">
        <div class="row__label">Quién puede enviar desde él</div>
        <div class="row__hint">Leer lo lee quien ve la conversación. Enviar en nombre del espacio es aparte.</div>
      </div>
      <div class="row__ctrl">
        <div class="seg" role="group" aria-label="Quién envía">
          <button type="button">Solo admins</button>
          <button type="button" class="is-on" aria-pressed="true">Admins y coordinación</button>
          <button type="button">Todo el equipo</button>
        </div>
      </div>
    </div>
  </section>
</section>

<style>
  @layer components {
    .mb-page {
      --set-pad: clamp(16px, 1.6vw, 24px);
      max-inline-size: 60rem;
    }
    .mast {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin-block-end: calc(var(--set-pad) * 1.2);
    }
    .mast p,
    .mast h1 {
      margin: 0;
    }
    .mast__sub {
      max-inline-size: 60ch;
      color: var(--text-muted);
    }

    .group {
      margin-block-end: calc(var(--set-pad) * 2);
    }
    .group__head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-s);
      margin-block-end: var(--space-s);
      padding-block-end: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }
    .admin {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }

    .reads {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-l);
      padding-block: var(--space-xs);
    }
    .reads p {
      margin: 0;
      font-size: var(--text-s);
    }
    .reads__k {
      margin-block-end: var(--space-2xs) !important;
      color: var(--heading-color);
      font-weight: 500;
    }

    .row {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) minmax(280px, 1.6fr);
      gap: calc(var(--set-pad) * 1.4);
      align-items: start;
      padding-block: var(--set-pad);
      border-block-end: 1px solid var(--border-color-light);
    }
    .row:last-child {
      border-block-end: 0;
    }
    .row__lead {
      padding-block-start: var(--space-xs);
    }
    .row__label {
      font-size: var(--text-s);
      font-weight: 500;
      line-height: 1.3;
    }
    .row__hint {
      max-inline-size: 36ch;
      margin-block-start: var(--space-xs);
      color: var(--text-faint);
      font-size: var(--text-xs);
      line-height: 1.55;
    }
    .row__ctrl {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-s);
    }

    .providers {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
    }
    .conn p {
      margin: 0;
    }
    .conn__addr {
      font-size: var(--text-s);
      font-weight: 500;
    }
    .conn__meta {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .imap {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-s);
      inline-size: 100%;
    }
    .imap__go {
      display: flex;
      grid-column: 1 / -1;
      justify-content: flex-end;
    }
    .sig {
      margin: 0;
      padding-inline-start: var(--space-s);
      color: var(--text-muted);
      border-inline-start: 2px solid var(--border-color-light);
      font-size: var(--text-s);
    }

    .seg {
      display: inline-flex;
      flex-wrap: wrap;
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
    }
    .seg button.is-on {
      color: var(--text-color);
      background: var(--bg-ultra-light);
      box-shadow: var(--box-shadow-1);
      font-weight: 500;
    }

    @media (max-width: 47.999rem) {
      .row {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-s);
      }
      .row__lead {
        padding-block-start: 0;
      }
      .reads,
      .imap {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-s);
      }
    }
  }
</style>
