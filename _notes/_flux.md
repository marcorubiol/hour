# Flux — Hour

Running notes, in motion. Cuando algo se asiente: migrar fuera.

---

## 2026-05-19 — Demo load: gaps descubiertos cargando workspace `demo` en marco-rubiol-acc

**Contexto:** workspace `demo` creado en `marco-rubiol-acc` con producción ficticia "Última órbita" (1 project + 1 section tour + 3 shows BCN/MAD/VLC + 3 engagements + 2 cast_members + 1 cast_override + 6 crew_assignments + 7 dates + 4 asset_versions). Pre-carga ADR-034 añadió `cast_member` a 25 tablas. Carga manual vía SQL directo (sin UI), anotando fricción según iba. Lista honesta de gaps — algunos son schema, algunos son tool friction, algunos son UI ausente que Phase 0.2 debe responder.

### Schema-level (decisiones diferidas para Phase 0.5 o cuando friction emerge)

1. **`workspace_membership` ≠ `account_membership` en tracking de invitación.** Account tiene `invited_at + accepted_at + revoked_at + role`; workspace solo `accepted_at + invited_by + role` (sin invited_at ni revoked_at). Conceptualmente las dos tablas hacen lo mismo (member en N scope) pero divergen en columnas. Funciona — pero un día querremos timeline de "cuándo te invitamos vs cuándo aceptaste" en ambos niveles para soportar audit + revoke desde UI admin. Phase 1 admin UI lo va a pedir. Coste: 2 columnas + migration trivial cuando llegue.

2. **`asset_version_adapted_has_source` CHECK fuerza atomicidad.** Insertar adapted row + actualizar `adapted_from_id` después viola constraint. La estrategia "INSERT primero, UPDATE referencia luego" no funciona — hay que insertar adapted con el FK ya resuelto. Funcional para UI "click adapt, choose source" (atómico desde formulario). Problemático para imports incrementales/scripts: hay que ordenar inserts canónico → adapted o usar CTE WITH ... INSERT ... RETURNING. Anotar en runbooks/imports.md cuando exista.

3. **`crew_assignment` + `cast_override` + `cast_member` son tres tablas con vocabulario casi idéntico** (`workspace_id, show_id|project_id, person_id, role` + override/notes específicos). La asimetría intencional (cast project-scoped + cast_override show-scoped vs crew solo show-scoped) la documenté en ADR-034 pero la repetición estructural sigue. Re-evaluar Phase 0.5 si emerge fricción al renderizar road sheet con las tres mezcladas.

### UI flow gaps (Phase 0.2 debe responder al menos los dos primeros)

4. **No hay flow "promover `venue_name` snapshot a `venue` real".** `show` permite tanto `venue_id` FK como denormalizado `venue_name + city + country`. ¿Cuándo se promueve? Probablemente: "if `venue_name` aparece N veces sin venue_id, suggerir crear venue". Lógica de UI, no schema. Phase 0.2 road sheet UI debe permitir crear venue from inline mention o linkear venue existente.

5. **No hay flow "crear engagement vs asignar cast_member"** desde la misma persona. Si Lucía es cast del proyecto, pero también podría ser engagement (programmer de otro venue), la UI debe distinguir las dos relaciones de la misma `person`. Probable resolución: panel `person/[slug]` lista "Cast in N productions" + "Engagement in M projects" + "Crew on K shows" + "Venue contact in J venues" como tabs/secciones de la misma persona. Phase 0.2 al construir Contacts lens — D5 si entra mobile-first.

6. **No hay UI de upload para `asset_version`.** Phase 0 lo asume — todos los URLs son R2 keys conceptuales. Demo data tiene URLs hardcoded a `demo/ultima-orbita/...` que no existen en R2. El road sheet UI puede renderizar links pero el upload llega Phase 0.3+. Si el render falla por 404 al fetch, fallback a "asset registrado, sin archivo subido aún" en el preview.

### Tooling / SQL friction (no es problema del producto)

7. **`UNION ALL` con `NULL` exige cast explícito** si la primera fila tiene UUID y la siguiente NULL. Detalle Postgres, no schema. Para imports incrementales conviene `NULL::uuid`.

8. **DST window en MAD show (2026-10-24 → 2026-10-25)**. `load_in_at` 13:00 CEST, `wrap_at` 00:30 CET. SQL guarda timestamptz correctamente, pero la UI debe convertir a `venue.timezone` para display — y el wrap_at del 25 cae después del DST switch. Sin `venue.timezone`, render asume UTC o local del usuario. Phase 0.2 road sheet UI: dual-timezone display (D-PRE-10) debe respetar el cambio horario dentro del mismo show. Edge case raro pero real (2026 tiene el switch el 25 de octubre, próxima oportunidad real con datos de gira octubre/noviembre).

### Mental-model ↔ schema alignment (los más importantes)

9. **Cast vs crew asimetría (resuelta hoy, pero merece quedar capturada).** El dominio operativo es asimétrico: cast se planifica una vez con sustituciones puntuales, crew se decide show a show. ADR-034 lo encodea (`cast_member` project-scoped, `crew_assignment` show-scoped). La pregunta cobra: ¿hay otras asimetrías similares en el modelo que aún no encajamos? Probable: `asset_version` también lo es (canónico project-scoped + adapted show-scoped + inbound show-scoped). Ya está modelado correctamente. Crew vs roles internos del sistema (RBAC) también — `project_membership` es para roles de Hour (producer, viewer), no cast/crew. Separación firme.

10. **`show.engagement_id` opcional** — pero en demo todos los shows tienen programmer, así que todos lo tienen seteado. ¿Caso real donde NULL? Self-produced en local propio (compañía dueña del venue), gigs internos. Mantener nullable. Phase 0.2 road sheet UI: si engagement_id NULL, omitir sección "Programmer / Contacto del venue" o derivar de `venue.contacts`.

---

## 2026-05-18 — TAM levers: qué amplía mercado de verdad (vs qué solo mejora retención)

**Estado:** conversación estratégica con .zerø validada por Marco. No es decisión, es mapa de palancas para mirar al planificar Phase 0.5+. Si una de estas se prioriza explícitamente sobre otra, migra a `_decisions.md` como ADR.

**Contexto:** análisis de viabilidad de Hour como producto. Pregunta de partida: ¿qué construir después de Phase 0.4 amplía el TAM atacable, vs qué solo mejora la experiencia dentro del TAM ya identificado? El roadmap actual ordena por arquitectura limpia (validar transversal antes de profundizar módulos), no por palanca comercial. Útil revisar ambos ejes.

### Lo que NO amplía TAM (aunque sea valioso)

- **`task` entity** (Deferred D1, hoy en Phase 0.5+ según roadmap). Sube retención (Hour pasa a estar abierto a diario en vez de solo para difusión), sube conversión post-trial (demos más cerrables), habilita guest links útiles (D6). Pero **no trae gente nueva**: una compañía que hoy gestiona con WhatsApp + Excel no salta a Hour porque añadas tasks. Los gates de adopción (volumen suficiente, apertura a SaaS, willingness-to-pay 30-60€/mes) no se mueven.
  - **Matiz importante**: el roadmap difiere tasks a Phase 0.5+, **Marco no está cerrado a adelantarlas**. Si emerge fricción real en Phase 0.1-0.3 (p.ej. road sheet pide "asignar load-in del jueves a X"), revisar moverlas. Decisión abierta, no cerrada.

### Lo que SÍ ampliaría TAM (palancas reales)

1. **Comms integradas** (Deferred D4). La palanca con más leverage. Si Hour ahorra escribir 30 emails de difusión el lunes (con tracking de aperturas, draft contextualizado por engagement, BCC archive estilo Basecamp), la propuesta de valor pasa de "organiza mejor" a "ahorra horas reales". Esto sí mueve compañías que hoy viven en Excel + Gmail. Probablemente el primer multiplicador de mercado real. Acoplado a `share` (ADR-028) y a `engagement` como contenedor de conversación, encaja en el modelo existente.

2. **Multi-perfil dentro de un workspace** (técnico freelance, manager externo, sala invitada como guest, además de los miembros core de la compañía). Permite vender a un ecosistema en vez de a una empresa aislada y desbloquea segmentos adyacentes.
   - **Verificado 2026-05-18** (lectura directa de schema.sql + migración `2026-05-01_reset_v2_roadsheet.sql` + rls-policies):
     - ✅ **Técnico freelance puntual** (sonidista para UNA gira) → cubierto. `workspace_membership(role='guest')` + `project_membership(project_id=gira_id, roles=['performer'|'technical_director'])`. RLS sobre `show`/`date`/`engagement` gateada por `has_permission(project_id, ...)`, no por workspace → ve SOLO los gigs/dates/engagements de esa gira.
     - ✅ **Manager externo / promotor coorganizador** (colaborador de UN proyecto) → cubierto. Mismo patrón, rol `producer` con permisos `read:money`, `edit:show`, `edit:engagement`, `read:engagement`. Persons son globalmente compartidas dentro del workspace (by design ADR — contactos son activos compartidos), no hay manera de ocultarlos por project.
     - ✅ **Sala invitada / venue como guest** (co-productor de UN show) → cubierto. `asset_version` tiene 4 RLS policies aplicadas vía migración (líneas 643-686), usando `project_id_of_asset_version(project_id, line_id, show_id)` que resuelve el project_id desde la FK que esté seteada. Guest con `project_membership` sobre el project del show ve y edita sus asset_versions, no toca otros.
     - ❌ **Anonymous-read vía signed link** (técnico que entra solo a su road sheet SIN login) → NO cubierto, diferido a Phase 0.5 (Deferred D6 en `_context.md`). Falta: tabla `public_share`/`share_token`, RLS `TO anon`, route `/public/[entity]/[token]`. ADR-022 menciona "partial D6 activation" para road sheet en Phase 0 (signed URLs), activación completa Phase 0.5.
   - **Veredicto operativo**: 3 de 4 perfiles cubiertos hoy. El 4º está documentado como diferido. Multi-perfil interno con login = listo. Multi-perfil sin login (anonymous share) = pendiente con scope claro.
   - **Nota correctiva**: el dump `build/rls-policies.sql` está desfasado vs migraciones aplicadas; consultar siempre `build/migrations/*.sql` para verdad de RLS. Tachar este punto de la lista de palancas de TAM — la palanca multi-perfil estructural ya está. Queda solo el caso 4 (anonymous link) que ya está en el roadmap.

3. **Plantillas verticalizadas + onboarding self-serve**. Plantilla "gira musical sala 100-500", plantilla "obra teatro temporada", plantilla "festival de creación contemporánea", plantilla "residencia". Escala atacando segmentos sin demo individual. Conecta naturalmente con `section.kind` enum de ADR-031 (las plantillas son perfiles preconfigurados de section + project + roles + protocolos). Trabajo medio (no requiere schema nuevo grande), impacto alto en conversión self-serve cuando llegue Phase 1.

### Recomendación de orden (no decisión)

Si hubiera que priorizar palanca comercial: **comms (D4) antes que tasks (D1)**. Tasks mejoran lo que ya tienes; comms abren mercado nuevo. Plantillas vienen detrás, asociadas a Phase 1 self-serve.

Pero esto compite contra el principio de "validar transversal antes de profundizar módulos" del roadmap. No resolver desde aquí — re-mirar cuando lleguemos a Phase 0.4 cierre y haya primer cliente real probando.

### Cross-arts confirmado (no solo teatro)

Sub-pregunta resuelta: Hour es cross-arts estructuralmente (schema neutro, `section.kind` cubre tour/season/circuit/creation/campaign/residency, `show` es genérico, `engagement` igual de válido con programador musical, director teatral, curator festival). Perfil de cliente real (género aparte): compañía/banda/colectivo autogestionado 3-15 personas, 50-300 fechas/año, mid-size europea.

No encajan: música comercial con agente/label (territorio SystemOne/Stagent), salas/festivales que programan (territorio Spektrix/Artifax), música clásica institucional (Orfeo en FR), solistas pequeños sin volumen (Google Calendar + Gmail les sobra).

**Implicación de marketing**: producto cross-arts desde el código, comunicación inicial probablemente arranca con el caso piloto MaMeMi (performance + música) y abre a otros géneros vía testimonios. "Tool para artes en vivo" suena a todo y a nada.

---

## 2026-05-09 — `share` (cristalizada → ADR-028)

**Estado:** cerrada en 4 rondas de grilling el 2026-05-09. Migrada a `_decisions.md` como ADR-028. Roadmap Phase 0.5 item 4. Bloque de exploración debajo se mantiene como rastro del proceso de pensamiento; el contenido canónico vive en el ADR.

---

## 2026-05-09 — Bucket compartible (proceso de exploración, archivado)

**Idea cruda:** Tener por cada contacto (engagement) o posible show una "carpeta" (bucket) dedicada, compartible online con esa persona. Espacio dedicado para entregar/intercambiar materiales con un programador concreto durante la difusión.

**Por qué surge:** durante difusión MaMeMi (154 contactos activos 2026-27) hay flujo constante de envío de dossiers, vídeos, riders, propuestas. Hoy vive en email + WeTransfer + Drive a mano. Idea = unificar dentro de Hour.

**Conexiones con lo que ya existe:**
- `asset_version` ya existe con `direction enum (outbound|inbound|adapted)` — captura assets enviados/recibidos/adaptados.
- Deferred D6 (Public guest links) ya contempla URL firmada para que externos vean lo suyo sin signup.
- `engagement` es la unidad scope (workspace + persona + project).
- El bucket podría ser **la superficie de entrega** de assets que ya el schema modela.

**Preguntas abiertas (a desarrollar antes de cualquier ADR):**
1. Scope: bucket por `engagement` (la conversación con UN programador) o por `show` (la obra que se ofrece, compartida entre programadores)? O combo: assets canónicos en show + overlay personalizado por engagement?
2. Quién sube/baja: solo Marco escribe / contacto lee? O bidireccional (contacto sube respuestas técnicas, contratos firmados, fichas de venue)?
3. Auth del lado del contacto: signed link público (D6 anonymous-read) o requiere registro mínimo? Tradeoff: fricción vs trazabilidad.
4. Personalización: mismo dossier para todos, o variantes por engagement (idioma, repertorio destacado, vídeo concreto)? Si hay variante → relación M:N con override layer.
5. Lifecycle: cuánto vive el bucket? Si engagement queda en `not_interested` → archive automático? Hard delete después de N meses?
6. Tracking: ¿queremos saber si el programador abrió el bucket / qué archivos vio? Implica analytics + cookies en el lado público (privacy implications).
7. Storage: R2 ya está en stack (`MEDIA` binding, bucket `hour-media`). Naming: `engagements/<engagement-slug>/...` o `shows/<show-slug>/engagements/<engagement-slug>/...`?
8. UX: ¿es una página propia del bucket en `/h/<ws>/engagement/<slug>/share`, o un toggle "shareable" sobre la vista normal del engagement?
9. Diferenciación con WeTransfer/Drive: ¿qué hace que un programador prefiera abrir un link de Hour vs un Drive? (curaduría, branding, presentación, persistencia).
10. Estado del arte: ¿competidores (Bandsintown for venues, Hello Stage, Eventbase…) lo hacen? Mirar antes de diseñar.

**Dirección probable (a validar):** combinar `show.assets` canónicos + `asset_version` direction=outbound + tabla `engagement_share` (o similar) que define qué subset del show se expone en el bucket de ese engagement, con signed URL de larga duración (rotable).

**No decidir todavía:** scope (engagement vs show), auth model, tracking. Necesita más conversación + revisar competidores Phase 0.5/D6.

### Round 1 de respuestas (2026-05-09)

1. **Scope: engagement Y show, con replicación VISUAL no real.**
   - Engagement: archivos estándar (dossier, vídeos, propuesta).
   - Show: archivos técnicos (plano luces, rider).
   - Los archivos viven una sola vez (canónicos en show o engagement); el bucket los **referencia**, no los duplica. Encaja directo con `asset_version` + una tabla de "qué se muestra dónde" (engagement_share / bucket_view).

2. **Bidireccional + sincronizado con email.** Cuando el programador responde por email con un adjunto, el adjunto aparece en el bucket. Cuando se sube algo al bucket, podría triggerear notificación al hilo. → **Esto adelanta parte del Deferred D4 (Communication layer)**, ahora habrá que decidir cuánto.

3. **Link mágico, sin login.** Signed URL larga duración + rotable. Sin login para el programador. Implicaciones aceptadas: tracking limitado a hits del link (mitigable si el link es único por destinatario).

4. **Propuesta de valor: version control + curación.** "Drive al principio, esto después." El valor añadido real:
   - **Curación**: este programador ve estos 4 archivos, ese otro ve esos 6.
   - **Versioning**: cada programador siempre ve la versión que TÚ decides — no el adjunto del email del año pasado.
   - El bucket NO es un Drive con UI bonita; es un **visor curado de assets versionados**.

**Patrón equivalente fuera del sector:** mini "deal room" (DocSend, Dock, Notion deal rooms para ventas B2B). Mismo problema: enviar materiales curados, versionados, con tracking ligero a un contraparte que no quiere registrarse. Mirar como referencia técnica/UX antes de Phase 0.5.

**Decisión implícita confirmada:** esto NO es R2 + signed URL pelado. Es una superficie de UI con identidad (landing/microsite por engagement), aunque el contenido real lo provea R2.

### Round 2 — respuestas (2026-05-09)

A. **Email sync mínimo viable: opción (a)** — panel "conversación" en Hour, lectura sola. NO se adelanta D4 con integración real. (Pendiente clarificar: lectura ¿de qué fuente? ver Round 3.)
B. **Versioning UI: solo la última versión visible al programador.** El histórico vive en `asset_version` internamente, pero la UI pública oculta. Curatorial.
C. **Selector + assets propios del engagement.** Schema necesita soportar assets cuyo scope es solo-este-engagement (no asociados a show).
D. **Landing/microsite, no carpeta.** La apuesta es presentación; competir con dossier-PDF bonito, no con Drive bonito.

### Forma del modelo (post Round 2)

- **Microsite por engagement** (no por show): URL única, contenido curado, layout tipo landing.
- **Assets** tienen scope: `show` (canónico, reusable entre engagements) o `engagement` (one-off, propios del bucket).
- **Tabla intermedia** `engagement_share` (o `bucket_item`): selecciona qué assets aparecen en el bucket de un engagement, en qué orden, qué versión es "current" (siempre `asset_version` más reciente con `direction=outbound` salvo override manual).
- **Conversación**: panel embebido en el bucket (interno) y posiblemente visible al programador (TBD privacidad). Solo lectura — no sync real con email cliente todavía.
- **Auth pública**: signed URL larga duración, rotable. Sin login del programador.

### Round 3 — respuestas (2026-05-09)

1. **(1b) BCC manual a `eng-xxx@in.hour.zerosense.studio`** — modelo Basecamp ("loop in by email"). Marco hace BCC en sus respuestas; emails + adjuntos quedan archivados en Hour, indexados al engagement. Programador NO ve la conversación archivada — es panel privado de Marco.
2. (resuelta en 1) — privacidad: panel solo Marco.
3. **On-demand pero disimulado.** No hay botón explícito "armar microsite". La primera vez que Marco hace click en "crear link" o "compartir", el microsite se materializa lazy. No hay 154 stubs vacíos.
4. **Branding show-driven con subtítulo customizable.** "MaMeMi presenta TRES" + slot opcional de subtítulo ("para Ana Martínez · Festival Grec"). Una sola plantilla por show, capa fina de personalización por engagement.
5. **Directo al bucket** (5a). Si después hay valor de reuso, se promociona a `show.assets`.

---

### Modelo cerrado — síntesis (lista para crystallize en _decisions.md cuando arranque la spec)

**Nombre tentativo:** `pitch` (vocabulario performativo, no comercial — encaja con anti-CRM). Alternativas: `dossier`, `share`, `microsite`. **TBD.**

**Concepto:** un microsite por engagement, lazy-creado al primer click de "compartir", servido vía signed URL larga duración a un programador externo sin login, con presentación show-driven y conversación archivada por BCC para uso interno.

**Entidades nuevas (propuesta):**
- `pitch` — uno por engagement (1:1 o 1:N si quieres pitches diferentes a la misma persona). Campos: `engagement_id`, `show_id` (qué show vende), `subtitle_override`, `signed_token`, `created_at`, `last_viewed_at`, `revoked_at`.
- `pitch_item` — selector de assets visibles + orden. Campos: `pitch_id`, `asset_id`, `position`, `version_pin` (NULL = siempre last).
- `asset.scope` enum (`show` | `engagement`) o `asset.engagement_id` nullable — para los uploads directos al bucket.
- `pitch_email` — emails archivados vía BCC. Campos: `pitch_id`, `from`, `subject`, `body`, `received_at`, `raw_eml_r2_key`.
- `pitch_view` — log mínimo de hits. Campos: `pitch_id`, `viewed_at`, `ip_hash`, `asset_id` opcional (qué se descargó).

**Stack técnico:**
- **Email ingest**: Cloudflare Email Workers (free, recibe email en Worker, parsea con `postal-mime`, escribe a R2 + Postgres). Cierra el loop sin terceros.
- **Storage**: R2 binding `MEDIA` ya está. Naming: `pitches/<pitch-id>/assets/<asset-id>` o referencia a `shows/<show-id>/assets/...` cuando es canónico.
- **Auth pública**: signed JWT en URL (`/p/<token>`), valida pitch existe + no revocado. Sin sesión.
- **UI pública**: ruta `/p/[token]` con layout landing-style (hero del show, vídeo full-bleed, secciones de archivos, footer personalizado).
- **UI interna**: vive en `/h/<ws>/engagement/<slug>` — pestaña "Pitch" o equivalente, con botón "Compartir" que crea/copia el link, panel de conversación archivada, vista de actividad ("Ana abrió hace 3 días, descargó plano luces").

**Solapes con roadmap existente:**
- **Adelanta D6** (Public guest links) en parte — ya tenían signed URL para road sheet, ahora se generaliza.
- **Adelanta D4** (Communication layer) en parte — ingest de email, sin envío todavía.
- **Reusa `asset_version`** (direction=outbound) sin modificar.
- **Reusa MU R2 + signed URL** ya en stack.

**Ubicación en roadmap:** NO Phase 0.0 ni 0.1. Encaja como **Phase 0.5 differentiator** o **Phase 1 wedge feature** (lo que hace que un programador de competencia abra los ojos). Coste estimado bruto: 2-3 semanas (1 sem schema + UI interna + share button; 1 sem microsite público; 0.5-1 sem email ingest + parsing).

### Round 4 — preguntas técnicas que faltan (las únicas)

A. **¿Naming?** `pitch` / `dossier` / `share` / `microsite` / otra. Mi opinión: `pitch` (performativo, anti-CRM, una sílaba, traduce a EN/ES bien).
B. **¿Tracking de lectura del link?** Mínimo (just hits) / medio (qué archivos se descargan) / cero (privacidad por defecto).
C. **¿El link caduca o es eterno hasta revoke manual?** Programadores responden con calma de meses; un link que caduca a 30 días es fricción. Pero un link eterno es vector de leak.
D. **¿Phase 0.5 o se mete en 0.4?** Esto define si arrancas a especificarlo en 1 mes o en 4. La diferenciación de venta puede justificar adelantarlo si Phase 1 está en camino.
