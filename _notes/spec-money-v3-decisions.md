# Money v3 — decisiones del grill (BORRADOR, pre-ADR-086)

> **Estado: ESTRUCTURA CERRADA en grill con Marco 2026-07-21.** Nada
> implementado, cero schema tocado. Falta la parte de **diseño** (Marco no la hará
> en caliente) y el **build**. Cuando se apruebe este consolidado → cristaliza
> como **ADR-086** en `_decisions.md` y entra en `_tasks.md` como build propio.
>
> Origen: empezó como "cerrar identidad fiscal" (gap #3 de contenedores) y el
> grill lo llevó a un rediseño del dinero. **La identidad fiscal es una pieza
> dentro de money v3, no una tarea suelta.**

## En una frase

El dinero deja de girar alrededor de la factura. **El bolo (su fee) es el ancla;
cobrar y facturar son dos hechos independientes.** Se construye el libro de
entrada/salida (tamaño A) preparado para la contabilidad completa (tamaño B) sin
reescritura.

## Frontera de producto que se cruza a conciencia

`_context.md` dice que Hour **no** es la gestoría. Money v3 reabre esa frontera
en parte: Hour pasa a ser el libro de dinero de la compañía. Marco lo decide a
sabiendas: el tamaño A no traiciona el producto; el tamaño B (nómina/intermittents,
P&L, cierre) es otro calibre y **no se construye ahora**. Gate, como ADR-085: no
ampliar a B sin señal de uso real.

## Decisiones cerradas

### D1 · La factura es un documento real que Hour emite, módulo por espacio
`workspace.settings.invoicing_mode` ∈ **{off, interno, legal}** (mismo patrón que
`booking_mode`):
- **`off`** — no se emite documento; el dinero se registra igual (D3).
- **`interno`** — documento con numeración propia; la factura legal la emite otro
  fuera. Se llama **Proforma**. No exige datos fiscales del receptor.
- **`legal`** — Hour ES el sistema de facturación: documento legal completo. Se
  llama **Factura**.

### D2 · Identidad fiscal = su propia tabla `fiscal_identity`
*(Cambiado respecto al primer borrador, que la ponía como columnas en account y
workspace: el set de campos creció a ~13 y duplicarlo en dos tablas dejó de ser
limpio.)*

Tabla `fiscal_identity` — "los datos fiscales de una parte legal":
- `label` (distingue "MüK SL" de "María autónoma") · `legal_name` · `tax_id`
- `address_line_1` · `address_line_2` · `postal_code` · `city` · `region` · `country`
- `iban` · `swift_bic`
- `default_vat_pct` · `default_irpf_pct`

Notas de F1:
- **Dirección estructurada** (no bloque de texto): el PDF es inminente + la
  facturación electrónica (EN-16931/Facturae) la pide + habilita autocompletado.
  `address_line_2` = piso/puerta (manual); el resto lo rellena el autocompletado.
- **`tax_id`/`swift_bic` genéricos** para todo el mundo (no "NIF"). IBAN solo es
  SEPA; SWIFT cubre el resto.
- **`tax_regime` descartado** (el % por factura ya lleva la verdad; sin uso hoy).
- Extras por país → `custom_fields`.

**Dueño BLANDO** (clave para el futuro, ver más abajo): hoy `account_id` (tu
emisor) **o** `workspace_id` (un receptor tecleado). Extensible a
`organization_id` + flag "compartible" sin migración.

Resolución + snapshot:
- `account.default_fiscal_identity_id` + `workspace.fiscal_identity_id` (override).
- La factura resuelve `workspace ?? account` y **congela** la identidad como
  snapshot (igual que los importes, ADR-050).
- **Refina ADR-062** (decía "el fiscal vive en el espacio"; el caso freelance
  demuestra que el workspace no siempre es quien factura).

### D3 · El dinero es el suelo; facturar es opcional encima
- `payment.invoice_id` → **nullable**; el pago gana **ancla de scope**
  (bolo/línea/proyecto) y **contraparte**.
- **El fee del bolo es el ancla.** La factura es un documento opcional que apunta
  al mismo fee. **"Cobrado" se deriva de pagos contra el fee**, no contra la
  factura → cobrar-antes/después de facturar sin duplicar.
- **Invierte la derivación de "paid" de money v2 (ADR-074)** → esto es money v3.
- Respeta ADR-050: no hay tabla `transaction` polimórfica única.

### D4 · Alcance: tamaño A ahora, expandible a B sin reescritura
- **A (se construye)**: entradas (cobros desacoplados) + salidas (gastos),
  ancladas a bolo/proyecto, con saldos.
- **B (NO se construye, solo no se cierra)**: dinero hacia artistas (`payable`),
  categorización contable, P&L, cierre.
- **Expandibilidad estrecha**: `payment` y `expense` comparten espina —
  **scope · contraparte · categoría** (nullable ahora, load-bearing en B). B es
  aditivo: tabla hermana `payable` + vistas de informe. Cero migración de A.
- **Guardia**: B-ready = desacoplar pago + `categoría`/`contraparte` nullable.
  Nada más. Si aparece libro mayor/asientos/saldos que nadie pidió, me pasé.

### D5 · Numeración: auto-correlativa en los dos modos
- **Automática, no manual** (referenciable, sin error de tecleo; y auto ayuda al
  cumplimiento legal, que exige sin huecos).
- **Dos series separadas** — no comparten contador:
  - Factura (legal): por `fiscal_identity` + año.
  - Proforma (no-legal): por `workspace` + año.
- Número asignado **al emitir** (el borrador no lo tiene). Contador atómico por
  (emisor/workspace, tipo, año).

### D6 · El receptor reutiliza `fiscal_identity`
- El receptor (venue) es una `fiscal_identity` **workspace-owned** (sin banco ni
  defaults — asimetría aceptada, columnas nullable sin usar en ese lado).
- La factura enlaza `issuer_fiscal_identity_id` + `payer_fiscal_identity_id` y
  **congela ambas** al emitir.
- **Difiere la entidad `organization` (gap #1)**: el fiscal del receptor existe
  solo y se enganchará a la organización cuando llegue.
- Solo hace falta en modo **legal**; en proforma/off el receptor es solo un nombre.

## Futuro / forward-compat (NO build — pero nada puede cerrarlo)

**Enlace fiscal entre empresas, con consentimiento.** Un teatro (organización)
puede **opt-in** a exponer su identidad fiscal; otra compañía "añade ese teatro" y
su fiscal se autorrellena por **referencia**, no por copia. Es el patrón de
`person`/`workspace_person` (identidad global + dossier local) aplicado al fiscal,
y la misma filosofía consent-first de la IA.

Lo que ya lo habilita (por eso no cierra nada):
- `fiscal_identity` es **entidad** (se comparte y referencia; unas columnas, no).
- La factura **congela snapshot** → el enlace es seguro sea cual sea la fuente.

Lo que hay que **cuidar en cada decisión de v3**: el **dueño blando** de
`fiscal_identity` (no clavar "receptor = siempre workspace-privado"). Extensión
futura: `organization_id` + flag "compartible" + **verificación** de la identidad.

Matiz legal: el punto es el **consentimiento**. Empresa (razón social/CIF) ≈
público; **autónomo** = dato personal → el opt-in es el requisito, no un adorno.
Conecta con gap #1 (`organization`).

## Delta de schema

**A — se construye:**
- Tabla `fiscal_identity` (dueño blando `account_id`|`workspace_id` nullable;
  campos de D2).
- `account.default_fiscal_identity_id`, `workspace.fiscal_identity_id`.
- `invoice`: `type` (factura|proforma) · snapshot emisor + receptor congelado ·
  FKs `issuer_fiscal_identity_id`/`payer_fiscal_identity_id` · `number` asignado
  al emitir desde su serie · pasa a documento opcional que referencia el fee.
- Contadores de serie (legal por fiscal_identity+año; proforma por workspace+año),
  incremento atómico al emitir.
- `payment`: `invoice_id` nullable · + ancla scope · + contraparte · + categoría.
- `expense`: + contraparte nullable (ya tiene categoría y scope).
- `workspace.settings.invoicing_mode`.
- Derivación de "cobrado" reescrita: pagos vs fee.

**B — NO se construye (solo forward-compat):**
- Tabla `payable` (dinero a personas), misma espina.
- Vistas P&L / categorización contable.
- `fiscal_identity` compartible + directorio de organizaciones + verificación.
- Entidad `organization` (gap #1) — el receptor se le engancha después.

## Consecuencias y secuencia

- **Refina ADR-062** (hogar del fiscal → tabla `fiscal_identity`).
- **Supersede la derivación de cobro de money v2 (ADR-074)** → money v3.
- **Build propio, ADR-086. Va PRIMERO, antes de la revisión de contenedores**
  (F4). El campo "identidad fiscal" de la portada queda absorbido aquí.
- **PDF de factura/proforma "casi ya"** (Marco): entra en el primer corte de v3,
  no en el Shelf. Necesita house-style → diseño.
- Backup/preflight + tests RLS proporcionales (payment/invoice, ~11 políticas).

## Lo que falta antes de poder construir (necesita cabeza de diseño)

- House-style del PDF de factura/proforma.
- Formularios de `fiscal_identity` (autocompletado de dirección = API externa,
  después).
- Cambios de UI de Money (pago desacoplado; el fee como ancla).
