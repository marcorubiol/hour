# Revisión adversarial de los prototipos — 2026-07-20

> 5 lentes en paralelo (filosofía · structure-model · coherencia de modelo · día del bolo · render medido).
> 53 hallazgos; los que ya he arreglado en esta sesión no salen aquí. Quedan 45.
> Cada uno lleva evidencia verificable (línea, clase o número medido) — si no la lleva, se descartó.

## _kit.css

### [REAL] Eight classes hand-rebuild `.eyebrow`, whose whole point is a `--eyebrow-tracking` variable contract for exactly this variation.

**Evidencia:** base.css:1673-1689 ships `.eyebrow { font-family:var(--font-mono); font-size:var(--text-xs); font-weight:500; letter-spacing:var(--eyebrow-tracking); text-transform:uppercase; color:var(--eyebrow-color) }` plus `.eyebrow--sub` which redeclares tracking only. The prototypes re-type that recipe as properties in `_kit.css:188` `.crumbs__space`, `_kit.css:357` `.run__label` (letter-spacing:0.14em — literally the `.eyebrow` default value), `_kit.css:496` `.qnote__tag`, `_kit.css:508` `.modeswap`, permissions-editor:65 `.lvl__k`, person-roles-org:127 `.cv__kind`, operator-invite:99 `.form__k`, comms-hub:138 `.fchip`. Philosophy §2 anti-pattern, named verbatim: "classes that repeat padding, font-family, color when those values already come from the semantic selector".

**Arreglo propuesto:** Compose: `class="eyebrow"` plus a modifier that redeclares only `--eyebrow-tracking` / `--eyebrow-color` (e.g. an `.eyebrow--loose` at `var(--mono-letter-spacing-loose)`, which is the tracking the six non-0.14em copies actually want). Each class then declares only what genuinely differs — `.fchip`'s border, `.modeswap`'s pill shape, `.form__k`'s fixed 9rem column.

### [REAL] `.mk` re-implements the shipped `IdentityMark.svelte` and has already drifted from it on four measurable properties, and its size modifier redeclares three properties where the real component exposes one variable.

**Evidencia:** `IdentityMark.svelte` declares the identical `--c` contract and derives `--_bg: color-mix(in oklch, var(--_c) 16%, var(--bg-ultra-light))` / `--_fg: oklch(from var(--_c) 0.42 c h)` — `_kit.css:303-304` copies both expressions exactly, so this is a transcription, not an independent design. What diverges: font-weight 500 vs the component's 600; `box-shadow: 0 0 0 1px var(--_bd) inset` dropped entirely; `border-radius: var(--radius-s)` (fixed 4px) vs `calc(var(--_m) * 0.28)` (scales); and size, which the component exposes as the single `--mark` variable, is redeclared in `_kit.css:323-327` `.mk--l` as three properties (inline-size, block-size, font-size). Philosophy §3: modifiers redeclare VARIABLES, never properties.

**Arreglo propuesto:** Give `.mk` the `--mark` size variable and let `.mk--l` be `{ --mark: 2.25rem }` and nothing else; restore the inset ring and weight 600 so the prototype does not validate a mark the app will not render.

### [REAL] The mono/xs/faint micro-caption recipe is typed out 24 times across the kit and the five prototypes with no class to own it.

**Evidencia:** Exact three-declaration sequence `font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-faint)` counted by regex: _kit.css 3 (`.rail__k`, `.run__sub`, `.who__why`), performance-page 7 (`.slot__note`, `.th__n`, `.th__when`, `.th__aud`, `.task__who`, `.who2__r`, `.who2__until`), permissions-editor 3, person-roles-org 4, operator-invite 3, comms-hub 4. Plus inline copies of the same three properties at comms-hub:607 and 612, person-roles-org:264, operator-invite:310. base.css offers `.eyebrow` (uppercase) and `.text--xs` (size only) but nothing for the lowercase mono caption, which is why everyone re-types it.

**Arreglo propuesto:** Add one contextual class to base.css — e.g. `.meta { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--meta-color, var(--text-faint)) }` — with `--meta-color` as the contract so `.mx__note--over` (warning), `.mx__thread--no` (danger) and `.task__when--due` (danger) become one-variable modifiers instead of new rules.

## base.css

### [REAL] `.kbd` fails AA in every prototype and every theme — it is the only defect that reproduces 12/12.

**Evidencia:** base.css:1654 `.kbd { color: var(--text-muted); background: var(--bg-ultra-light) }`. Rendered-pixel ratios for the "⌘K" hint: light 2.44 (performance-page), 3.84 (operator-invite, permissions-editor, person-roles); dark 3.12–3.73. Worst case 2.44:1 at 10.2px. `--text-muted` is 70%-alpha ink, and `--bg-ultra-light` raises the backdrop under it, so the pair loses on both ends. This is app code, not prototype-local — it ships wherever `.kbd` is used.

**Arreglo propuesto:** Use `--text-color` (full-opacity ink) for `.kbd`, or drop `--bg-ultra-light` to the plain surface. Alpha ink on a lifted fill is the combination that fails; changing either one clears it.

## comms-hub-performance-prototype.html

### [BLOCKER] `facet` / `faceta` is a new primitive with no entry in structure-model.md, and it does triple service (thread grouping, permission unit, gutter label) across four levels — a cross-cutting dimension the model has no slot for.

**Evidencia:** `grep -ni "facet|faceta" build/structure-model.md` returns zero hits. structure-model.md:19-51 lists exactly five primitives: Entity, Container, Lens, Module, Task. Meanwhile comms-hub-performance-prototype.html uses `faceta` six times as the `run__sub` label of each thread gutter (lines 277, 318, 351, 385) and counts them in the section header (266: "4 facetes · 1 fil lliure"); permissions-editor-prototype.html:304 heads the permission matrix column `Matèria` with per-row level lists (319, 331, 342, 353, 364, 376). comms-hub-performance-prototype.html:582-586 states the finding outright: "El chip de faceta y la etiqueta del gutter son el mismo objeto". A facet is not a module (it exists at espai and bolo, where modules may not), not a lens (it is not cross-container aggregation), and not an entity.

**Arreglo propuesto:** Add a sixth primitive to structure-model.md § Primitives: **Facet** — a per-level access + grouping dimension, data not code (per spec §2 lines 69-76), orthogonal to modules. Include the level table from spec-access-comms-decisions.md:40-48 and state the invariant that a facet gates and groups but never composes a surface.

### [BLOCKER] The dissolved “outside the wall” band is still drawn, with the difusión programmer sitting on a gig page.

**Evidencia:** Line 537: `<div class="who who--outside">` under `<p class="eyebrow eyebrow--sub">Fora del fil — s'hi parla per correu</p>`, containing `Dries Douibi` / `role-badge programació` / `rost__why Conversa de difusió`; the section count reads `7 operadors · 2 fora del fil` (line 455). Digest §5: “The 'outside the wall' band dissolves … the programmer nowhere on the gig at all — he belongs to the difusión conversation.” performance-page-prototype.html line 498-506 states the same conclusion as settled.

**Arreglo propuesto:** Delete the band. Put the venue contact under a *La sala* block (as performance-page does with Gerard Puig) and remove the programmer from the gig entirely.

### [BLOCKER] `General` is labelled a facet and counted as one, contradicting §2 and the sibling prototype.

**Evidencia:** Lines 274-278: `<article class="run run--general">` … `<a class="run__label" href="#">General</a><span class="run__sub">faceta</span>`; section count line 266: `4 facetes · 1 fil lliure` (General, Tècnica, Logística, Diners). permissions-editor-prototype.html line 382 says the opposite in words: `General … no és una matèria, és la pertinença al contenidor`.

**Arreglo propuesto:** Change `run__sub` for General to `pertinença al bolo` (or drop the sub entirely) and recount as `3 facetes · 1 general · 1 fil lliure`.

### [REAL] A table is built out of `<div>`s, and the column widths are then duplicated between the CSS classes and inline styles on the header row — two hand-synced copies of the same magic numbers.

**Evidencia:** comms-hub:103-135 sets `.rost__id{inline-size:13rem}`, `.rost__roles{12rem}`, `.rost__sees{flex:1}`, `.rost__why{12rem; text-align:end}`; lines 464-467 then re-type all four as inline styles on the header spans (`style="inline-size: 13rem"`, `12rem`, `flex: 1`, `12rem; text-align: end`). permissions-editor repeats the defect: `.mx__facet{12rem}` / `.mx__seg{21rem}` / `.mx__thread{11rem}` (99-134) versus the inline 12rem/21rem/11rem at 304-306. Meanwhile base.css:362-381 already gives `<table>`/`<th>`/`<td>` defaults including the uppercase micro-label treatment on `th`.

**Arreglo propuesto:** Use `<table>` — the header/body column contract is what the element is for, base.css already styles it, and the widths collapse to one set of `<col>`/`th` rules that the rows cannot drift from.

### [REAL] This prototype still embodies the model the 2026-07-19/20 session superseded — hub-as-page and the dissolved "outside the wall" band — and it was written AFTER the file that supersedes it, with no supersession marker.

**Evidencia:** spec-access-comms-decisions.md:175-176: "The hub is a section of the gig page, not the page. What earlier passes drew was the hub full-screen with the gig compressed into a header line." That is precisely this file: the masthead reduces the gig to a title and then makes threads its headline stat — `mast__stats` at 233-237 reads `7 a l'equip · 5 fils · 3 sense llegir`, with nothing about call times or venue. spec line 168-172: "The 'outside the wall' band dissolves … The band was the symptom of one undifferentiated list." The band is still there: `<div class="who who--outside">` at 537 with header `Fora del fil — s'hi parla per correu` (538). mtime is 01:15:07 vs performance-page-prototype.html at 01:08:15, and `git diff` shows the only edit made to it in that pass was the preset rename `Producció→Coordinació` / `Convidat→Mínim` (lines 506, 530) — the superseded structure was left untouched and re-blessed.

**Arreglo propuesto:** Either delete the file or put a banner at the top of `<main>` and in the `<title>`: superseded by performance-page-prototype.html on 2026-07-20, kept only for the Desk MISSATGE test (591-634) and the audience-derivation detail. As it stands, a reader picking a file at random gets the retired model with fresh naming, which is the worst of both.

### [REAL] A preset name outside the ladder is used in the roster.

**Evidencia:** Line 518: `<span class="rost__why">Tècnic, només en aquest bolo</span>`. The ladder is Mínim · Equip · Coordinació · Direcció (digest §1); the same roster uses ladder names in the two rows around it (`Coordinació, a la gira` line 506, `Mínim, a la gira` line 530). `Tècnic` is a *rol*, not a preset — precisely the collision §1 renamed `Producció` to avoid.

**Arreglo propuesto:** `Tècnic, només en aquest bolo` → `Equip, només en aquest bolo`.

### [NIT] The `.who--outside` band that the decision record retires is still shipped by _kit.css and drawn by comms-hub, so the two newest prototypes now disagree on it.

**Evidencia:** `_notes/spec-access-comms-decisions.md:169-172`: "The 'outside the wall' band dissolves… The band was the symptom of one undifferentiated list." `_kit.css:439-445` still defines `.who--outside` with the comment "Drawn, never dropped: the boundary must be visible", and comms-hub:537-557 renders it ("Fora del fil — s'hi parla per correu"). performance-page (the newest, 01:08) correctly drops it and puts Gerard under `La sala` instead — its own qnote at line 498 says so.

**Arreglo propuesto:** Delete `.who--outside` from `_kit.css` and rework comms-hub's two rows into their own blocks, or the kit will keep offering the retired component to the next screen that needs a list of non-operators.

### [NIT] The operator count does not match the rows, and two people who appear in thread audiences are missing from the roster.

**Evidencia:** Header says `7 operadors · 2 fora del fil` (line 455) but `.rost__row` person rows number 5: MR, AN, LF, JS, PM (lines 470, 483, 496, 509, 521). `Clara Vidal` (line 305, `permís a l'espai`) and `Tomàs Roig` (line 306, `permís en aquest bolo`) are in the General and Tècnica audiences and in no roster row.

**Arreglo propuesto:** Add the two rows or set the count to 5. The roster is the “who enters and why” surface; it cannot be a subset of the audiences it explains.

## line-detail-prototype.html

### [NIT] The shell avatar monogram drops to 2.68:1 in dark — white ink kept over a fill that lightens with the theme.

**Evidencia:** `div.shell__avatar` "M" at 14px/600: rendered-pixel ratio 4.30:1 light (fill rgb(79,122,193)), 2.68:1 dark (fill rgb(122,159,221)). The fill lifts for dark but the glyph stays white, so dark is the worse of the two — inverted from the usual direction. line-detail is the Jul 17 file with its own embedded kit, so it did not get the accent lift the shared tokens got.

**Arreglo propuesto:** Flip the monogram to `--text-light` (which the dark block already re-anchors to a dark ink, tokens.css:490) so it tracks the fill instead of fighting it.

## operator-invite-flow-prototype.html

### [REAL] The prototype silently redefines `.form`, a real app class from base.css, with a different layout model.

**Evidencia:** base.css:356-359 (@layer defaults) declares `.form { display: grid; gap: var(--space-s) }` with the comment "`:where(form)` is too aggressive; use .form when it applies". operator-invite:88-92 declares, unlayered, `.form { display: flex; flex-direction: column; gap: var(--space-m) }`. The prototype wins today only because it is unlayered; the moment this markup moves into a Svelte component (scoped and layered) the app's grid `.form` applies and the row layout changes. `_kit.css:6-7` explicitly promises "new class names only → zero collision with base.css" — the promise holds for _kit.css but is broken in the prototype's own `<style>`.

**Arreglo propuesto:** Rename to `.invite` / `.invite__row` / `.invite__k`, or drop the local rule and accept base.css's grid.

### [REAL] `General` is drawn as a graded permission row in the invitation preview — same error as the permissions editor.

**Evidencia:** Line 281: `<div class="who__line"><span class="who__name">General</span><span>veure</span><span class="who__why">preset Equip · a la gira</span></div>`.

**Arreglo propuesto:** Replace with a membership statement, not a `veure` row.

### [REAL] The `invitat` has no entry path anywhere. The only door drawn is `Convidar a operar`, while the newest prototype already shows a guest inside a gig.

**Evidencia:** operator-invite-flow line 207 and person-roles-org line 368 both offer exactly one action: `<button class="btn--outline btn--s" type="button">Convidar a operar →</button>`; the second door is `door--closed` with `contrapart de difusió · no s'hi convida` (invite-flow line 213, person-roles line 373). Step 5 asserts `Un programador és un subjecte: rep coses, no entra. La seva fitxa no ofereix cap manera d'equivocar-se` (lines 354-356). Yet performance-page line 450 shows `Sílvia Munné … convidada · fins al 8 ag` inside *Qui ve*. Digest §3: “the wall was never membership; the wall is the login and the seat.”

**Arreglo propuesto:** Add the second door to both files — `Convidar sense compte →` — with its three obligatory fields (facets, container, end date) and the Diners confirmation line from §4. Until it exists, the guest is an outcome no screen can produce.

## performance-page-prototype.html

### [REAL] The facet→accent mapping now exists in three places; the newest prototype bypasses the kit modifiers that own it and re-states the mapping inline, five times.

**Evidencia:** `_kit.css:375-386` owns the mapping as modifiers (`.run--tecnica { --run-color: var(--accent-6) }`, `--logistica: accent-8`, `--diners: accent-3`, `--general: accent-1`). performance-page's Conversa block at line 296 is a bare `<article class="run">` with no facet modifier, so the mapping is re-typed inline at 304 (`style="color: var(--accent-6)"`), 306 (`style="--run-color: var(--accent-6)"`), 315, 317 and 326. comms-hub restates the same four pairs a third time as `--f` inline styles at 474-477, repeated per roster row (487-490, 500-503, 513-516, 525-528). Changing Tècnica's hue now needs edits in three files.

**Arreglo propuesto:** Put the facet modifier on the run/row container (`class="run run--tecnica"`) and let `.th__name` / `.fchip` read `var(--run-color)`; the inline styles disappear and the mapping stays only in `_kit.css`.

### [REAL] Road sheets is a line module in structure-model but Full de ruta exists only at bolo in the facet table — so the module lives at a level where its own permission facet does not exist.

**Evidencia:** structure-model.md:87 lists `Notes · Materials · Road sheets` as "— (module only) … yes" for line-level edit, and :96 puts `Road sheets` in the module catalog, which by :43-44 exists "only at the line". The facet table at spec-access-comms-decisions.md:47 gives `Full de ruta` a mark under `bolo` and dashes under espai/projecte/línia, and permissions-editor-prototype.html:381-383 spells the consequence out in the UI: "Full de ruta no hi és — no és que estigui a 'res': a nivell de línia no existeix. Només viu al bolo." performance-page-prototype.html:459-465 renders it in the gig rail. Concretely: a Coordinació preset granted at línia (permissions-editor:274) can never carry Full de ruta, yet permissions-editor:423 shows Laia holding `Full de ruta · veure + editar` via an override — the effective-permissions block grants a facet the level table says cannot be granted there.

**Arreglo propuesto:** Reconcile in one direction. Either Road sheets stops being a line module and becomes performance-level content (consistent with the facet table and with `roadsheet_share` being per-date), or Full de ruta gains a `línia` cell. The permissions-editor's own §D block (423) is currently self-contradicting against its own §C note (381), which is the cheapest place to see that the two docs disagree.

### [REAL] There is not a single phone number on the page, for anyone.

**Evidencia:** Nine people are named — 8 in «Qui ve» (lines 413-452) and Gerard Puig under «La sala» (line 402) — and every one carries only initials (`.mk--person`) and a role string (`.who2__r`). `screen-data-spec.md` § Person detail lists the live contact block as «email, phone, website, languages», and § Performance detail lists `crew_assignment.contact_override` as existing schema. At 08:05, when Sílvia writes «el pont de contra ja està penjat» (line 309) and the truck is not there, the action is a call, and the page cannot produce a number.

**Arreglo propuesto:** Put phone (and a `tel:` link) on each row in «Qui ve» and on the venue contact — either inline in quiet mono or on a per-person expand. This is the definition of the rail's own criterion: looked up, simply true.

### [REAL] The page offers a write action to a person it simultaneously declares has no access, with no defined destination.

**Evidencia:** Line 403: «escriu-li →» next to Gerard Puig; line 502 of the same file states «Gerard (producción de la sala, sin acceso)». Either the link is a mailto (then it is not the app's comms and should not use the thread verb), or it opens a thread with him — which per `_notes/spec-access-comms-decisions.md` § 4 is a delegation act requiring an explicit invitat grant with an end date and a confirmation line, none of which is on the page.

**Arreglo propuesto:** Decide and label it: `mailto:`/`tel:` for an outside contact, or «convida'l a un fil →» which routes through the invitat flow. The current string hides a permission act behind a chat verb.

### [REAL] Logistics, hospitality and technical — three data blocks the spec says already render on this screen today — are entirely absent, so hotel, catering, parking and dressing rooms are nowhere.

**Evidencia:** `screen-data-spec.md` § `/h/[ws]/performance/[slug]` § Today: «ProductionStub (venue block + contacts, 5-slot dual-tz ScheduleTable, logistics/hospitality/technical JsonKV)». The prototype has the venue block and the schedule and drops all three JsonKV sections. The sibling `comms-hub-performance-prototype.html` line 363 shows where that information actually ends up: a chat message, «Hotel Ciutat, 4 habitacions dobles». Same failure inside this file — Ana Solé's arrival is a General thread line (line 340), not a field.

**Arreglo propuesto:** Add a rail block for hospitality/logistics (hotel + address, catering, parking/dock, camerinos) fed by the existing jsonb. It is pure look-up-and-true — exactly rail material — and it removes the incentive to bury arrivals in General.

### [REAL] On a theatre company's show page there is no cast: «Qui ve» lists eight people and not one performer, and substitutions have no representation.

**Evidencia:** Lines 413-452 give roles direcció, producció, road manager, so, llums, so, producció — all crew. `screen-data-spec.md` § Performance detail names `cast_member`, `cast_override` («substitutions are tour reality») and § Line modules § Team confirms cast/crew already render elsewhere. At 08:00 the highest-stakes fact is who is on stage tonight and who is covering; the page cannot answer it.

**Arreglo propuesto:** Split «Qui ve» into repartiment and equip (same visual grammar, one heading each), and render `cast_override` inline on the replaced row — «X per Y» — because a substitution is the single most consequential day-of change.

### [REAL] The road sheet block states a pending action in the rail, offers no way to perform it, and no task covers it — a dead end on the page's most time-critical document.

**Evidencia:** Lines 461-465: «Última versió dilluns · encara no enviada a l'equip.» plus a single «Obrir el full de ruta →». By the file's own criterion (line 491) the rail is «lo que consultas y simplemente es cierto» — «not yet sent» is neither. `screen-data-spec.md` § Road sheet lists share links create/copy/revoke, role-pinned, as shipped today; none is reachable from here. The three tasks (lines 366-383) are about the comanda number, dimmers and acreditacions — nothing about sending the sheet.

**Arreglo propuesto:** Move the send/share state to the centre as a task or a call row («enviar el full de ruta a l'equip»), and leave in the rail only the immutable part: the link and the version date. If it stays in the rail, it needs the share control next to it.

### [REAL] There is no door from the gig to the difusión conversation it came from, which is the whole planning-lens question three weeks out.

**Evidencia:** `screen-data-spec.md` § Performance detail: «Conversation link: `conversation_id` is PATCHable but has no UI — 'this gig came from that conversation' closes the difusión→gig loop». Line 506 of the prototype actively banishes that context — «el programador no aparece: pertenece a la conversación de difusión, no al bolo» — and provides no link to it. At d-21 the question is what was agreed with the programmer: fee terms, how many funciones, who pays travel. Unreachable from here; the breadcrumb only goes up the container tree (lines 226-232).

**Arreglo propuesto:** One rail line under La sala or Diners: «Ve de la conversa amb {org/person} →». Banishing the programmer from the roster is right; banishing the conversation is a dead end.

### [REAL] Materials does not exist on the page, although it is a bolo-level facet, and facet threads that are not already open have no creation path at all.

**Evidencia:** `_notes/spec-access-comms-decisions.md` § 2 table puts Materials and Producció at bolo level; `permissions-editor-prototype.html` lines 323 and 335 render both. The gig page shows threads for Tècnica, Logística, Diners, General and one free thread (lines 302-351), no Materials, no Producció, and no materials/assets block anywhere — no rider, no plot, no plànol. The only creator is «+ fil lliure» (line 354). `screen-data-spec.md` § Performance detail also flags inbound `asset_version` (venue-returned docs) as unbuilt.

**Arreglo propuesto:** Add a Materials block (canonical rider/plot from the project + this gig's inbound docs) and make dormant facet threads startable — the facet list is data per § 2, so the section should render every bolo-level facet, open ones with their last message and closed ones as a quiet «obrir el fil».

### [REAL] The prototype cannot decide which day it is showing, so it cannot be judged as the 08:00 page it argues for.

**Evidencia:** Line 242 says «divendres 25 de juliol · d-6», but line 261 marks the 14:30 arrival `slot slot--done` — a slot six days in the future rendered as completed. The threads are stamped «avui 08:05» / «avui 09:12» (lines 307, 338), which reads as the show day. There is also no now-marker: greying past slots is the only temporal cue, and on the actual day it will grey almost everything with nothing marking the next call.

**Arreglo propuesto:** Pick d-0 for this artifact, and give Horaris an explicit now-line (next slot promoted, past slots receded) instead of relying on a done state that has no meaning while the day is still ahead.

### [REAL] Money shows the fee but not the state named in the spec, and the two money statements on the page disagree.

**Evidencia:** Rail lines 473-474: «3.200 € + IVA» and «Factura emesa dt 15» — no status chip, no paid amount. The Diners thread (line 330) says «Factura emesa. Falta el número de comanda del teatre», i.e. the invoice is blocked. `screen-data-spec.md` § Performance detail asks for «`fee_amount fee_currency` + invoice state chip here»; § Money lens adds `expected_on` (gap #9) and paid-derived-from-Σpayments. The rail asserts a fact whose actual status lives in a chat line.

**Arreglo propuesto:** Render the invoice state chip and, once payments exist, paid-vs-total and `expected_on`. Prose in the rail must be derived from invoice state, never typed alongside it.

### [NIT] `.task__box` re-draws base.css's checkbox by hand and introduces a fifth radius value that no token provides.

**Evidencia:** Lines 132-139: `.task__box { inline-size:0.85rem; block-size:0.85rem; border:1px solid var(--border-color-dark); border-radius:2px }`. base.css:696-706 already ships `.check__box` at `1.125em` square with `border: var(--border)` and `border-radius: var(--radius-s)`, plus the checked tick at 727-734. The radius scale in tokens.css:300-307 is 4/6/10/14/50%/999px — 2px is not in it. Same class of nit at permissions-editor:57, `border: 1px solid var(--border-color-light)`, which is exactly what `var(--divider-light)` expands to (tokens.css:328).

**Arreglo propuesto:** Use the `.check` skeleton with a real `<input type="checkbox">` (it also makes the task rows tickable); use `var(--divider-light)` for the 1px light border.

### [NIT] The cast drifts between prototypes: the same first names carry different surnames and different roles, which makes the set unreadable as one system.

**Evidencia:** performance-page: `Laia Ferrer` / `producció` (line 421), `Pau Miralles` / `road manager` (425-426), `Jordi Serra` / `so` (430-431), `Núria Camps` / `llums` (435-436). comms-hub: `Laia Ferrer` / `road manager` (498), `Pau Miró` / `música` (522-523), `Jordi Sales` / `llums` (510-511), `Núria Cots` / `sala` (540-541).

**Arreglo propuesto:** Fix one cast list in `_kit.css`-adjacent notes and use it in every prototype. Roles especially — Laia is the §4 road-manager delegation example and reads as `producció` on the newest page.

### [NIT] The masthead spends its most prominent secondary slot on seating capacity while the show being performed is only breadcrumb-sized.

**Evidencia:** Line 247: «Sala Fabià Puigserver · 480 localitats» at mast level; the show, «Última òrbita», appears only as `.crumbs__mid` at line 228. Capacity is a negotiation datum for the d-21 lens; for a company in repertory the day-of question «which show tonight» is answered in the smallest type on the page.

**Arreglo propuesto:** Put the show name in the mast meta line and demote capacity to the venue fitxa, or to the rail's La sala block where the rest of the venue facts live.

### [NIT] The conversation gutter counter contradicts the threads it summarises.

**Evidencia:** Line 299: «5 fils · 3 sense llegir». Five `.th` blocks exist, but only two carry `.th__unread` (lines 306, 317), reading «2 nous» + «1 nou». Parsed as threads the number is 2; parsed as messages it is 3. The unit is not stated and the two readings disagree.

**Arreglo propuesto:** Say «3 missatges nous» or «2 fils sense llegir». Given each thread already carries its own unread mark, the gutter line is probably redundant and could just read «5 fils».

### [NIT] Five lifetime message counters occupy prime space in the thread rows and drive no decision.

**Evidencia:** `.th__n` at lines 305, 316, 327, 337, 347: «14 missatges», «9 missatges», «6 missatges», «21 missatges», «fil lliure · 4 missatges». The actionable numbers are already present: the unread mark and `.th__when`. Nobody chooses which thread to open based on a total of 21.

**Arreglo propuesto:** Drop `.th__n` except where it carries type information («fil lliure»), which is the one instance that earns its place.

### [NIT] The schedule's timezone sub-label fires when there is nothing to disambiguate.

**Evidencia:** Line 258: «hora local de Barcelona» on a Teatre Lliure gig viewed, presumably, from Barcelona. `screen-data-spec.md` § Timezone rule: «display venue-local as primary truth with viewer time as secondary courtesy only when they differ». A permanent label states a difference that does not exist and will be tuned out before the Lyon gig where it matters.

**Arreglo propuesto:** Render the label only when viewer tz ≠ venue tz, and when it does fire, show both times on the slots rather than a note in the gutter.

### [NIT] Small mono metadata labels cluster just under AA in light mode — a systemic `--text-faint` at 10.2px issue, not a one-off.

**Evidencia:** Light mode, rendered pixels: `.who2__r` "llums" 3.59:1, `.who2__r` "so" 4.11:1 ×2, `.task__who` "Marco" 4.00:1 (performance-page); `.app__when` "mar – jun 2027" 3.84:1, `.org__when` "des de 2023" 4.29:1 (person-roles); `.lvl__k` "Bolo" 3.94:1, `.role-badge` "tècnica" 4.28:1 (permissions-editor). All at 10.2px. These are the role and date labels the rail carries per spec §5 ("rail = what you look up and what is simply true").

**Arreglo propuesto:** Raise `--text-faint` one step in light, or set a floor: below 11px, use `--text-muted` rather than `--text-faint`. Most of these clear 4.5:1 with a single step.

## permissions-editor-prototype.html

### [BLOCKER] The bolo (performance) is drawn as a fourth scope level and a fourth edit level; structure-model.md declares exactly three of each.

**Evidencia:** permissions-editor-prototype.html:277 renders a fourth `.lvl__step` labelled `Bolo`; operator-invite-flow-prototype.html:246 offers `Un bolo` as a grantable Nivell; performance-page-prototype.html:235 has `editar el bolo` plus composers `+ fil lliure` (354) and `+ tasca` (385) on the gig page itself. Against that: structure-model.md:26 says "Three nesting levels" and defines bullets only for Space / Project / Line (lines 29-33); structure-model.md:60-65 enumerates "Three edit levels: Space — Project — Line → modules". `performance` appears in the chain at line 27 and as an entity at line 21, but is never given container-scope or edit-surface status. The spec's own §2 table (spec-access-comms-decisions.md:40-48) makes `bolo` a full column with six facets, and §2 line 80-83 concedes "any level other than project" does not exist yet — so this is a model gap, not a mockup slip.

**Arreglo propuesto:** Amend structure-model.md § Primitives: either promote `performance` to a scopeable container with its own edit level (making it four levels, and stating that its page composes sections the way a line composes modules), or state explicitly that the gig page is a *rendering* of line-level modules filtered to one date and that permissions can never be granted at bolo. The prototypes have already picked the first; the doc has to say so or the prototypes are drift.

### [BLOCKER] `Materials` is shown as granted at espai level, a cell the level table marks as non-existent.

**Evidencia:** Line 425: `<span class="who__name">Materials</span><span>veure</span><span class="who__why">preset Mínim · a l'espai</span>`. Digest §2 table: the espai column has only Converses and Diners; Materials starts at projecte.

**Arreglo propuesto:** Move the source of that grant to projecte (`preset … · a MaMeMi`) or drop the line. A preset applied at espai must be unable to emit Materials at all — that is the safety argument the per-level table was chosen for.

### [REAL] `.block` / `.block__head` are a second name for `_kit.css`'s `.sec` / `.sec__head` — the four declarations of `.block__head` are byte-identical to `.sec__head`, and the prototypes already mix the two vocabularies in one element.

**Evidencia:** permissions-editor lines 24-31 and person-roles-org lines 24-31 both declare `.block__head { display:flex; align-items:baseline; justify-content:space-between; gap:var(--space-s); padding-block-end:var(--space-xs); border-block-end:var(--border) }` — the same six declarations as `_kit.css:271-278` `.sec__head`. `.block` (margin-block-start: var(--space-xl)) is `.sec` (_kit.css:265-270) minus the flex column. Proof they are one thing: permissions-editor:231-233 puts `<span class="sec__count">` INSIDE `<header class="block__head">`, and person-roles-org:280-283 does the same. Philosophy §4: one thing, one category.

**Arreglo propuesto:** Delete `.block*` from both prototypes and use `.sec` / `.sec__head` / `.sec__count`. If `.sec`'s `display:flex; gap` is unwanted in these two pages, that is a `.sec--flat` modifier redeclaring a variable, not a parallel component.

### [REAL] Every one-of-N control in the prototypes is a row of unlabeled `<button>`s with no grouping, no name, and no selected state exposed — while base.css already ships a real radio skeleton.

**Evidencia:** permissions-editor:315-317 renders `res | veure | veure + editar` as three sibling `<button type="button">`; selection is carried only by the visual class `pill--on` (line 315) — no `role="radio"`, no `aria-pressed`, no `aria-checked`, no `<fieldset>`/`<legend>` anywhere in the file (grep: zero occurrences). Same pattern at 295-298 (preset ladder), operator-invite:243-256 (level + preset), permissions-editor:392/398/402 where a non-interactive `<span class="pill--sm pill--mono pill--on">sí</span>` inherits `cursor:pointer` from the skeleton at base.css:1448. base.css:708-755 already implements `.check--radio` over a native `<input type="radio">` with focus ring and checked dot, and base.css:97-100 already zeroes `<fieldset>`. Philosophy, Applied to HTML: "The browser ALREADY implements accessibility, validation, focus. NO `<div role="button">`."

**Arreglo propuesto:** Wrap each row in `<fieldset>` + visually-hidden `<legend>`, use `<input type="radio" name="facet-diners">` with the `.check` skeleton, and style the pill look off `:checked` — arrow-key navigation, group name and announced state then come free. Where a pill is a read-only value (line 392), use `.badge--*`, which base.css:919-921 defines precisely as "STATIC visual indicators… no interactive states".

### [REAL] "Equip" now carries three unrelated meanings across the prototype set — the exact collision §1 renamed Producció and Convidat to kill, missed on this word.

**Evidencia:** (1) a permission preset: operator-invite-flow-prototype.html:254 `<button …>Equip</button>`, repeated as "preset Equip" at 281-284 and 308; also permissions-editor-prototype.html:296. (2) a space-level surface: permissions-editor-prototype.html:207 breadcrumb `MüK Cia › Equip › Laia Ferrer`, and 192 `<span class="eyebrow">equip</span>` — an operator/access roster hanging off the space. (3) the line's cast/crew module: structure-model.md:7 ("the line's cast/crew module = Team"), :86 and :96 catalogue. Preset ladder in spec §1 line 31 is "Mínim · Equip · Coordinació · Direcció", so meaning (1) is decided and locked. Meaning (2) is also a module name appearing above the line, which structure-model.md:101 names as drift by that exact test.

**Arreglo propuesto:** Rename one of them. Cheapest: the space-level roster surface (2) becomes `Accés` or `Qui hi entra` — it is the permissions door, not the cast list, and the performance page already uses that phrasing (`Qui entra i per què →`, performance-page-prototype.html:454). Leave the preset and the Team module as they are, and record the rename as an extension of spec §1's collision table.

### [REAL] `Convidar` survives as a separate capability toggle, which §4 explicitly abolished.

**Evidencia:** Lines 396-398: `<span class="caps__name">Convidar (operadors o invitats)</span> <span class="pill--sm pill--mono pill--on">sí</span> <span class="caps__why">acotat al que ella té</span>` — a sí/no gate. Digest §4: “this rule replaces the separate 'invite' capability gate … One rule instead of two.”

**Arreglo propuesto:** Remove the row. If anything is shown there, it is a statement, not a switch: `Pot convidar dins del que ella té — logística, tècnica; mai diners`.

### [REAL] The file still presents the two-lists question as open and bets on an answer the digest did not take.

**Evidencia:** Lines 432-446: `chirrido 7 · NUEVO, el más gordo … Tres salidas: (a) … (b) … (c) declarar que el hilo es <b>un permiso más de cada faceta</b> … <b>Mi apuesta: (c)</b>`. Digest §2 closes it: “The two lists … were never two lists — they were one list seen at two heights,” with the level table as the answer. The prototype's own `On existeix` column (lines 319-376) already renders that answer, so the note argues against the matrix printed above it.

**Arreglo propuesto:** Replace the chirrido-7 paragraph with the settled statement (one list, per-level existence, absent ≠ denied) or strip the qnote.

## person-roles-org-prototype.html

### [REAL] `.door*` and `.block__lead` are copy-pasted between two prototypes and have already diverged on measured values — the exact anti-pattern philosophy.md names ("the utility function redefined in every file").

**Evidencia:** `.door`, `.door__where`, `.door__why`, `.door--closed` appear in person-roles-org:170-192 and again in operator-invite:62-85, rendering the same UI object (a link row with an invite affordance). Divergence: `.door__where { inline-size: 21rem }` (person-roles-org:180) vs `20rem` (operator-invite:73); operator-invite's `.door` adds `flex-wrap: wrap`, person-roles-org's does not. Same for `.block__lead`: `max-inline-size: 48ch` (permissions-editor:36) vs `52ch` (person-roles-org:36). `.actions` also differs: `border-block-start: var(--border)` (permissions-editor:181) vs `var(--divider-light)` (operator-invite:140).

**Arreglo propuesto:** `.door` is shared chrome across two prototypes of the same flow — it belongs in `_kit.css` once, with the width as a variable if the two contexts genuinely need 20 vs 21rem.

### [REAL] The Conversations/Team boundary at structure-model.md:86 is crossed on the person page, and unlike the comms hub the crossing is not flagged.

**Evidencia:** The page is reached through the Conversations lens (breadcrumb `MüK Cia › Converses › Ana Solé`, line 243) and its `Converses` block (310-345) is correct booking-network content. But the `Aparicions` block (381-397) shows `equip · sonidista` (389) and `equip · disseny de so` (394) — cast/crew assignments, i.e. Team-module data — under the sub-head "on surt al repartiment i a l'equip tècnic" (384). structure-model.md:86 draws the line hard: "Team — module only … distinct from Conversations (Conversations = who you book with; Team = who does the show)". The file's three qnotes (399-429) flag the role-vocabulary collision and the ADR-082 §6 door problem, but never the lens boundary. The comms hub does flag it explicitly (comms-hub-performance-prototype.html:562-570, citing `structure-model.md:86`), so the model is known to be under pressure here — this file just crosses it quietly.

**Arreglo propuesto:** Decide and record: a person entity's page shows every relation she has regardless of which lens you arrived through (in which case structure-model.md:86 should say the boundary is about *set membership and aggregation*, not about what an entity page may display), or `Aparicions` moves behind a link to the line's Team module. State it in structure-model.md § Read surfaces so the next prototype does not re-litigate it.

### [NIT] `.mx__note` is applied in a file where it is not defined, and the inline style silently carries the styling.

**Evidencia:** Line 264: `<span class="mx__note" style="font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-faint)">`. `.mx__note` is declared only in permissions-editor-prototype.html:111 — grep across `_kit.css` and the other four prototypes returns nothing. The class is inert here; remove it and nothing changes.

**Arreglo propuesto:** Drop the dead class and replace the inline triple with the shared micro-caption class from the previous finding.

## tokens.css

### [REAL] The light-mode accent ramp fails AA when used as text, so the facet colour language (Logística/Tècnica/Diners) is sub-4.5:1 on cream — while the same labels pass in dark.

**Evidencia:** Measured on `.th__name` at 12.75px on `--bg` rgb(248,247,243): amber `--accent-8` rgb(176,133,5) = 3.16:1; cyan `--accent-6` rgb(0,153,160) = 3.23:1; green `--accent-3` rgb(59,149,85) = 3.49:1. Same failure on `.fchip` and `a.run__label` in comms-hub (3.16:1 ×6). Light accents sit at L 60-64% (tokens.css:151-156); the dark block lifts them to L 70-74% (tokens.css:546-551) and dark measures clean — performance-page dark has 5 contrast fails vs 32 in light. The asymmetry is the tell: dark was tuned for text use, light was not.

**Arreglo propuesto:** Either drop light `--accent-3/6/8` to ~L 52-55% (keeps hue, reaches 4.5:1 at 12.75px), or introduce a separate `--accent-N-ink` step for text and leave the current values for fills and rules. This is also the concrete cost of spec §5's open item 3 (concern palette vs facet palette) — decide it as one ramp with a text step.

