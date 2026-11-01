# Editor de correos «bonitos» para invitar al público

> 2026-11-01. Encargo de Marco: las compañías quieren enviar invitaciones a su público y a estrenos con correos
> diseñados (bloques, imágenes, botones, plantillas), tipo Mailchimp, que se vean bien en Gmail, Apple Mail y Outlook.
> ¿Hay un editor open source que Hour pueda usar? Todo leído el 2026-11-01 salvo que se diga otra cosa.
> **[V]** = comprobado en la fuente (repo, npm, código del paquete o la prueba); **[S]** = suposición o no
> comprobado. No incluye la plantilla fija por espacio de la difusión (logo, firma, imagen), que lleva otra sesión.

## Recomendación en 5 líneas

1. **Templatical** (`@templatical/editor` 0.52.0): el único que entra en Svelte 5 sin React (una llamada a `init()`
   sobre un `div`, aislado en Shadow DOM), trae la interfaz en es, ca, en y fr, guarda JSON y exporta MJML. En la
   prueba carga, exporta y compila a HTML con condicionales de Outlook; 198 KB gzip de carga inicial.
2. El riesgo es de proyecto, no de técnica: licencia **FSL-1.1-MIT** (código disponible, no OSI; permite expresamente
   embeberlo en un producto de pago y pasa a MIT a los 2 años de cada versión), repo de marzo de 2026 y un solo
   mantenedor humano con casi todos los commits. Mitigación: el renderizador es MIT y lo que sale es MJML estándar.
3. Plan B con la misma forma de datos: **GrapesJS + grapesjs-mjml** (BSD-3, maduro), a cambio de 690 KB gzip y una
   interfaz de herramienta de desarrollador que habría que vestir entera.
4. Alternativa sin editor de terceros: un editor de bloques fijos propio en Svelte (imagen, título, texto, botón,
   separador, dos columnas) que escribe MJML; menos libertad, más Hour.
5. Lo grande no es el editor: **el público no es una conversación**. Invitar al público pide una audiencia nueva
   (lista con consentimiento, alta con doble confirmación) y una identidad de envío separada de la difusión. Eso
   decide el tamaño, no el editor.

## Dónde encaja en Hour hoy

- El envío en bloque (ADR-109 a 115, `build/plans/2026-10-14-bulk-send.md`) manda **texto plano y un HTML gemelo
  mínimo** por SES `SendEmail` con contenido `Simple` (asunto, texto, HTML y hasta 15 cabeceras) [V, plan § 5]. El
  adaptador ya acepta HTML: un correo diseñado no cambia la llamada a SES, cambia de dónde sale el HTML.
- `mailout.body` es texto con `CHECK length BETWEEN 1 AND 20000`; cada destinatario es una **conversación** del
  proyecto (`set_mailout_recipients(p_id, p_conversation_ids)`) y cada envío deja un `conversation_event` [V, plan § 4].
  El público de un estreno no tiene conversación: el modelo de destinatario no sirve tal cual.
- El plan dice «texto antes que imagen; en este corte, sin imágenes» y un pie que monta Hour y no se puede quitar
  (identidad, base, baja en un clic, LSSI 20.1 y 21.2) [V, plan § 3]. Eso se mantiene: el editor diseña el cuerpo,
  Hour pone el pie.
- Medios: R2 (`hour-media`) [V, `build/architecture.md`]. Una imagen de correo tiene que ser pública y estable sin
  sesión; hoy no hay una ruta pública de medios para eso [S: no encontrada en la arquitectura].

## Candidatos

Actividad: commits en la rama por defecto desde el 2025-11-01 (la API corta en 100), por la API de GitHub. Licencia:
fichero `LICENSE` o campo `license` de npm.

| Candidato | Licencia | Actividad | Framework y entrada en Svelte 5 | Guarda | Salida |
|---|---|---|---|---|---|
| **Templatical** `templatical/sdk` | FSL-1.1-MIT en `editor`, `core`, `media-library`; MIT en `renderer`, `types`, `quality`, importadores [V] | v0.52.0 publicada el 2026-11-01; 100+ commits; repo creado el 2026-03-24; humanos: orkhanahmadov 372 commits, el siguiente 8 [V] | Vue 3 + TipTap empaquetados; `init({ container })` y `unmount()`, Shadow DOM por defecto: Svelte solo monta un `div` [V] | JSON propio (`TemplateContent`) [V] | MJML (`toMjml()`); HTML con un compilador MJML aparte [V] |
| **GrapesJS** + **grapesjs-mjml** | BSD-3-Clause los dos [V] | grapesjs v0.23.8 del 2026-10-15, 100+ commits; grapesjs-mjml v1.0.8 del 2026-03-13 (npm 2026-10-29), 25 commits [V] | JS sin framework; `grapesjs.init({ container })` [V] | JSON de proyecto o MJML [V] | MJML y HTML en el navegador (lleva `mjml-browser` dentro) [V] |
| GrapesJS preset-newsletter | BSD-3-Clause [V] | última versión v1.0.2 del 2023-06-09; 2 commits [V] | Igual que GrapesJS | HTML | HTML con estilos en línea, sin MJML [S] |
| Easy Email `zalify/easy-email` | MIT [V] | sin releases en GitHub; npm 4.17.1 del 2026-06-10; 22 commits [V] | React 18; la versión libre «Only supports Chrome» y no React 19; iframe, React 19 y móvil van en Easy Email Pro, de pago [V] | JSON propio | MJML, HTML |
| EmailBuilder.js `usewaypoint/email-builder-js` | MIT [V] | último commit 2026-02-09; 11 commits; npm 0.0.9 [V] | React; el editor es una app de ejemplo (Vite + MUI), no un paquete [V] | JSON | HTML con `renderToStaticMarkup` (React) [V] |
| Maily `arikchakma/maily.to` | MIT en el repo [V]; `@maily-to/core` sin campo `license` en npm [V] | npm 0.3.7 del 2026-10-27; 9 commits; arikchakma 570 commits, el siguiente 11 [V] | React 18/19 + TipTap + Tailwind; editor tipo documento [V] | JSON de TipTap [S] | HTML vía `@maily-to/render` (react-email, juice) [V] |
| **React Email editor** `@react-email/editor` | MIT [V] | npm 1.7.18 del 2026-10-30; publicado desde 2026-02-18; Resend detrás [V] | React 18/19 + TipTap [V] | No dicho [S] | HTML [V, blog de Resend 2026-04-17] |
| Unlayer `react-email-editor` | El envoltorio es MIT; el editor se carga de `https://editor.unlayer.com/embed.js` [V, `src/loadScript.ts`] | v2.1.3 del 2026-10-04 [V] | React (hay Vue/Angular) sobre un script remoto | JSON de Unlayer | HTML |
| Mosaico `voidlabs/mosaico` | GPL-3.0 [V] | v0.18.11 del 2025-08-22; 4 commits [V] | Knockout.js, Grunt; backend propio para subidas [V/S] | JSON + plantilla | HTML |
| MJML (motor) | MIT [V] | v5.4.1 del 2026-09-10; 100+ commits; 6.0 en alpha [V] | Ninguno: lenguaje y compilador | MJML | HTML con tablas y condicionales `mso` [V] |
| react-email (motor) | MIT [V] | react-email 6.11.6 del 2026-10-29; 100+ commits [V] | Componentes React | JSX | HTML |
| Templatical renderer (motor) | MIT [V] | Igual que Templatical | Sin UI | JSON | MJML [V] |

Comerciales que no se han mirado a fondo: Beefree SDK, Stripo, Topol. Sin precios comprobados.

### Por qué se descartan

- **Unlayer:** no es open source en lo que importa. El editor es un script remoto; el plan gratis existe pero la marca
  blanca empieza en Launch, **250 $/mes** (5.000 exportaciones), Scale 750 $, Optimize 2.000 $ [V,
  unlayer.com/pricing]. Que el gratis muestre la marca de Unlayer: no lo dice la página [S]. Además, los diseños
  pasan por sus servidores: un encargado de tratamiento más.
- **Mosaico:** GPL-3.0. El editor se sirve al navegador, así que se distribuye; combinado con el cliente de Hour
  arrastraría la GPL al código de Hour, que no tiene `LICENSE` (repo público, todos los derechos reservados) [V: no hay
  fichero de licencia en la raíz]. Pregunta de abogado si se quisiera; no merece la pena con 4 commits al año.
- **Easy Email:** la versión libre solo soporta Chrome y React 18 [V, README]. Lo necesario está en la de pago.
- **EmailBuilder.js:** sin commits desde febrero y el editor no es un paquete, es una app de ejemplo en React + MUI.
- **Maily y React Email editor:** buenos y MIT, pero React. En Svelte 5 entrarían como isla React (React y ReactDOM
  más el editor, peso sin medir [S]) y con dos sistemas de componentes en la misma pantalla. React Email editor es el
  más sólido de los dos (Resend detrás, MIT); queda como alternativa si Templatical falla y se acepta una isla React.
- **GrapesJS preset-newsletter:** parado desde 2023 y sin MJML; si se va por GrapesJS, es con grapesjs-mjml.

## Calidad del HTML (Gmail, Apple Mail, Outlook)

- Templatical, GrapesJS-mjml y Easy Email salen por **MJML**, el estándar de facto: tablas con `role="presentation"`
  y comentarios condicionales `<!--[if mso | IE]>` para el Outlook clásico [V en la prueba: 23 y 13 en Templatical, 7 y
  4 en GrapesJS]. react-email y Maily dan HTML de tablas por su cuenta [S: no probado].
- **Outlook clásico de Windows** sigue usando el motor de Word; el nuevo Outlook usa un motor de navegador. Microsoft
  mantiene el clásico al menos hasta 2029 y aplazó el cambio obligatorio a marzo de 2027 (resúmenes de prensa:
  theregister.com 2026-03-06, office-watch.com; sin leer el post de Microsoft) [S]. MJML sigue siendo necesario.
- **Recorte de Gmail a ~102 KB de HTML**: la cifra la dan proveedores (ActiveCampaign, Bird, beehiiv, MxToolbox), no
  una página de Google [S]. Las imágenes enlazadas no cuentan. La prueba sale en 11 KB (Templatical, 4 bloques) y 6 KB
  (GrapesJS, 3 bloques): hay margen, pero conviene medirlo en la vista previa y avisar antes de 80 KB.
- **Sin probar en clientes reales:** no se ha enviado nada a Gmail, Apple Mail ni Outlook, ni pasado por Litmus o
  Email on Acid. Es lo primero que haría un carril.
- Detalles vistos en la salida: Templatical pone `lang="en"` aunque la interfaz esté en `es` (el idioma del contenido
  es otro ajuste; cuál, sin mirar [S]). GrapesJS-mjml pone `lang="und"` y carga **Google Fonts** (Ubuntu) por defecto:
  en un correo lo pide el cliente de quien lo lee, pero mejor quitarlo.

## Imágenes y R2

- **Templatical:** `media` acepta un `MediaProvider` propio (`list`, `create`, `delete`... cada mutación `false | fn`)
  o `onRequestMedia` para abrir un selector propio; sin ninguno, la imagen es solo URL [V, `index.d.ts` y
  docs.templatical.com/backend]. Encaja con R2: `create({ file })` sube a un endpoint de Hour, que guarda en R2 y
  devuelve la URL pública. También trae recorte y biblioteca con carpetas [V, docs] (sin probar).
- **GrapesJS:** Asset Manager con endpoint de subida propio [S: no leído en la doc, la página de docs no lo detalla].
- **Easy Email:** `onUploadImage(blob) => Promise<url>` [V, README].
- Lo que pide Hour en todos los casos: una ruta pública de medios de correo (`/m/<id>` o un dominio de medios) que
  sirva desde R2 con caché larga y sin sesión, y que no caduque mientras el correo pueda abrirse; tamaño y anchura
  máximos al subir (p. ej. 1200 px, unos cientos de KB) [S: cifras a decidir].

## i18n y accesibilidad

- **Templatical:** interfaz en en, de, pt-BR, es, ca, fr, nl, ja [V, README y ficheros de locale]; la prueba en `es`
  sale traducida [V, captura]. El paquete `quality` revisa el correo: alt que falta o es un nombre de fichero, enlace
  o botón con texto vago, texto en mayúsculas, preencabezado que falta, poco texto [V, `index.d.ts`]. Accesibilidad de
  la propia interfaz (teclado, lector de pantalla): sin comprobar [S].
- **GrapesJS:** el núcleo trae locales es, ca, fr, en y más [V, `grapesjs/locale/`]. En la prueba, con `es`, el panel
  derecho siguió en inglés («Select an element before using Style Manager») [V, captura]; la causa no se investigó.
  Accesibilidad de la interfaz: sin comprobar [S].
- El resto: Easy Email, EmailBuilder.js y Maily no mencionan i18n en su README [V].

## Prueba

En `research/spikes/2026-11-email-builder/` (fuera del workspace pnpm, que solo mira `apps/*` y `packages/*`; nada
entra en `apps/web`). Dos páginas sueltas empaquetadas con esbuild 0.28.2 (ESM, minificado, con troceo), servidas en
local y cargadas con el Chromium de Playwright 1.59.1.

| | Templatical 0.52.0 | GrapesJS 0.23.8 + grapesjs-mjml 1.0.8 |
|---|---|---|
| Carga sin errores | Sí [V] | Sí [V] |
| Carga inicial (JS + CSS) | 633 KB, **198 KB gzip** en 50 ficheros; todo con perezosos, 2,1 MB / 674 KB gzip [V] | 2,5 MB, **690 KB gzip** en 2 ficheros (1,3 MB de grapesjs-mjml, 1,2 MB de grapesjs) [V] |
| Exporta | JSON 1,1 KB y MJML; HTML 11,3 KB compilado con `mjml` 5.4.1 en Node, 0 errores [V] | JSON 4,8 KB y HTML 6,0 KB en el navegador, 0 errores [V] |
| Llamadas fuera | `fonts.bunny.net` (fuente Geist de la interfaz) [V] | `cdnjs.cloudflare.com`, `app.grapesjs.com` (**telemetría activada por defecto**, `telemetry: !0` en el bundle; se apaga con `telemetry: false`) [V] |
| Marca | «Con la tecnología de Templatical» al pie; `branding: false` la quita y la licencia no exige atribución [V] | Sin marca [V] |

No comprobado en la prueba: arrastrar bloques a mano, subir una imagen, el `layout` de Templatical, accesibilidad de
teclado, y **si `mjml` 5 corre en un Worker**: empaquetado para navegador pide `fs`, `fs/promises` y `path` [V];
con `nodejs_compat` puede que baste, sin probar con `wrangler` [S]. `mjml-browser` 5.4.1 suelto pide `cheerio` al
empaquetarlo [V].

## Cómo se integraría (Templatical)

**Dónde se guarda el diseño.** El JSON de Templatical es la fuente; el HTML es un derivado congelado.
- Tabla nueva `mail_design` (por espacio: `workspace_id`, `name`, `content jsonb` con límite de tamaño, `created_by`,
  fechas): son las «plantillas». Las crean y reutilizan las compañías; los «saved blocks» de Templatical pueden ir a
  la misma tabla o a otra hermana [S: diseño].
- En el envío: `mailout.format` (`text` | `designed`), `mailout.design_content jsonb` (copia del diseño, no una
  referencia, para que editar la plantilla no cambie un envío) y `mailout.html` compilado al poner en cola. El texto
  plano alternativo se genera del HTML y se puede revisar.
- El pie legal y el enlace de baja los añade Hour en el `layout` de Templatical («Embedder-owned email shell [...]
  Never written into `getContent()`» [V, `index.d.ts`]) o, si eso no basta, envolviendo el MJML en el servidor. Las
  cabeceras `List-Unsubscribe` y `List-Unsubscribe-Post` siguen como en el plan.

**Cómo sale por el adaptador.** `renderToMjml(content)` (MIT, ligero) y `mjml` compilan a HTML en el servidor al poner
en cola; si `mjml` no corre en el Worker, el plan B es compilar en el navegador al guardar (con `mjml-browser`, más
peso) y validar en el servidor. Los campos por destinatario (`{nombre}`) van como merge tags de Templatical y Hour
los sustituye tras compilar, escapando HTML. SES `SendEmail` con `Simple` ya lleva HTML y texto: el adaptador no
cambia.

**Seguridad.** Quitar el bloque `html` de la paleta (allowlist de bloques) para que no entre HTML arbitrario, y la
vista previa en un iframe con `sandbox`.

**Qué cambia en el plan del envío en bloque.**
1. Un segundo tipo de envío, **invitación**, que no se dirige a conversaciones sino a una **audiencia de público**:
   personas que se apuntaron (formulario público con doble confirmación) o compradores con relación previa. Base
   jurídica distinta de la difusión B2B: la LSSI art. 21 pide consentimiento o la excepción del 21.2 (relación
   contractual previa y productos similares) [V, BOE-A-2002-13758, ya en `research/infra/2026-10-11-envio-en-bloque.md`].
2. Identidad de envío separada: otro remitente o subdominio y otro configuration set o tenant de SES, para que la
   reputación de las invitaciones no arrastre la de la difusión 1:1.
3. El historial: un envío a público no deja `conversation_event`; deja su propio registro por destinatario.
4. La difusión a programadores sigue en texto. «Texto antes que imagen» no cambia para ella.

**Tamaño aproximado** [S: estimación]. Editor, plantillas y medios: 2 carriles (uno de servidor: tabla, compilación
MJML en el Worker, ruta pública de medios en R2; otro de pantalla: el editor en Svelte, tema con los tokens de Hour,
vista previa). La audiencia de público (lista, formulario, doble confirmación, bajas, importación con base): 2 o 3
carriles más, y es lo que hay que decidir primero.

## Alternativa sin editor de terceros

Un editor propio en Svelte de **bloques fijos en columna**: imagen, título, texto (el editor de texto que ya use
Hour), botón, separador, dos columnas; sin arrastrar libre, con subir y bajar. Cada bloque se escribe como un
componente MJML y el servidor compila con `mjml` (MIT). Gana: interfaz de Hour, sin licencia FSL, sin dependencia de
un mantenedor; encaja con el gusto de Marco por lo sobrio. Pierde: plantillas ricas, columnas complejas, biblioteca de
medios y revisión de calidad hay que hacerlas. Tamaño: 2 a 3 carriles solo el editor [S]. Si después se quiere más,
el JSON propio se puede convertir a Templatical o al revés (ambos acaban en MJML).

## Entregabilidad

- **Pestaña Promociones de Gmail:** un correo con cabecera de imagen, botones y diseño va a Promociones casi seguro
  [S: Google no publica el criterio]. Para invitar al público es aceptable; para la difusión a programadores no, y
  por eso sigue en texto.
- **Imágenes:** nunca un correo que sea solo una imagen-cartel; texto real con el mensaje y alt en cada imagen (el
  `quality` de Templatical lo marca). Muchos clientes no cargan imágenes por defecto [S].
- **Peso:** HTML por debajo de ~100 KB (recorte de Gmail), imágenes enlazadas y no adjuntas, anchura 600 px y
  ficheros comprimidos.
- **Volumen:** a público, una compañía puede pasar de 5.000 correos al día; ahí se aplican las reglas de remitente
  masivo de Gmail y Yahoo (SPF, DKIM, DMARC, baja en un clic, quejas < 0,3 %) [V, investigación del 2026-10-11].
  Separar identidad y tenant (punto 2 de arriba) protege la difusión.
- Nada de píxel ni seguimiento de enlaces en este corte, como en el plan.

## Fuentes (leídas el 2026-11-01)

- Repos y actividad: API de GitHub `repos/<owner>/<repo>`, `releases/latest`, `commits?since=2025-11-01`,
  `contributors` para GrapesJS/grapesjs, GrapesJS/mjml, GrapesJS/preset-newsletter, zalify/easy-email,
  usewaypoint/email-builder-js, arikchakma/maily.to, unlayer/react-email-editor, voidlabs/mosaico, mjmlio/mjml,
  resend/react-email, templatical/sdk.
- Versiones y licencias npm: `npm view` de grapesjs, grapesjs-mjml, grapesjs-preset-newsletter, easy-email-*,
  @usewaypoint/email-builder, @maily-to/core, @maily-to/render, react-email-editor, mjml, mjml-browser,
  @react-email/components, @react-email/render, @react-email/editor, @templatical/editor, @templatical/renderer.
- Licencias: https://github.com/templatical/sdk/blob/main/LICENSE (FSL-1.1-MIT con «Additional Permission:
  Embedding»), https://github.com/GrapesJS/grapesjs/blob/dev/packages/core/LICENSE (BSD-3),
  https://github.com/voidlabs/mosaico (GPL-3.0).
- Unlayer: https://unlayer.com/pricing ; https://github.com/unlayer/react-email-editor (`src/loadScript.ts`).
- Easy Email: https://github.com/zalify/easy-email (README, comparativa con Pro).
- Templatical: https://github.com/templatical/sdk , https://docs.templatical.com/backend/ , README y `index.d.ts`
  de `@templatical/editor` 0.52.0.
- React Email 6 y su editor: https://resend.com/blog/react-email-6 (2026-04-17, actualizado 2026-07-09).
- Outlook: https://www.theregister.com/2026/03/06/microsoft_outlook_migration_postponed/ ,
  https://office-watch.com/2024/oh-ffs-classic-outlook-isnt-dying-in-2026 (prensa, no Microsoft).
- Recorte de Gmail: https://help.activecampaign.com/hc/en-us/articles/115001060524 ,
  https://docs.bird.com/applications/content/email-templates/concepts/gmail-clipping (proveedores, no Google).
- Hour: `build/plans/2026-10-14-bulk-send.md` (§ 3, 4, 5), `build/architecture.md`,
  `research/infra/2026-10-11-envio-en-bloque.md`.
