# Flux — Hour

Running notes, in motion. Cuando algo se asiente: migrar fuera.

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
