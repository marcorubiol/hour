# Grill 2026-07-23 — las 4 lentes + re-diseño de Money → **Books**

> **Qué es esto.** Salida de una sesión `/grill-me` (2026-07-23) sobre las tres
> preguntas de Marco: **A** ¿son 4 las vistas, ni más ni menos?, **B** ¿son los
> nombres correctos y coherentes entre sí?, **C** ¿mostramos lo necesario?
> Foco real: la lente **Money**, la que menos seguro tenía (es la parte de artes
> escénicas que nunca ha operado en persona).
>
> **Estado:** decisiones tomadas en grill, **NO cristalizadas** en `_decisions.md`
> todavía (append-only, requiere OK explícito). Esto es material de trabajo +
> plan de acción, no canon. Contrastado contra el código de `feat/money-v3-build`
> (2026-07-23) y contra terminología/regulación del sector (fuentes al pie).

---

## Principios que gobiernan (load-bearing)

1. **El dinero se externaliza pronto, pero la titularidad es de la compañía.** La
   gestoría hace *cumplimiento* (IVA/IRPF/nóminas) **fuera** de Hour. Hour hace
   *cobro-radar + handoff*. Marco nunca operó el dinero → su duda con Money no es
   de la vista, es que **no es su job-to-be-done**, es el de otro.
2. **El usuario diario es la persona de difusión** (crea assets/publicidad + hace
   outreach). Money no es su lente de cada día; sobrevive por otra razón (→ #4).
3. **Todo lo que construyamos debe aceptar in-housing futuro** sin rewrite. El
   modelo no cierra la contabilidad interna; solo no la construye hoy.
4. **La lente ES la costura de extensibilidad.** Money se queda como lente no por
   uso diario sino porque una lente puede empezar fina y profundizar sin
   reestructurar la nav. Degradarla y re-promoverla luego = el churn que #3 evita.
5. **Núcleo universal + adaptador de país.** El fiscal y la emisión legal son
   *inherentemente* por-país → costura obligada, pero como **frontera de datos**,
   no framework. Núcleo agnóstico de impuestos; España = primer preset.
6. **El bruto manda.** El precio de venta del bolo es la identidad; el neto tras
   tasas es compañero. Los dos visibles, prioridad al bruto.

---

## A — ¿Cuántas vistas? → **4 = un digest + tres lentes**

- **Más no.** *Difusión* = una **persona** que cruza lentes (resuelta por
  default-landing por rol), no un concern → no es lente. *Assets/Materials* =
  acceso rápido (**⌘K**) + readiness (**Desk**) + entrar al contenedor para curar
  → **no** es lente ("es un archivo" = tipo de almacenamiento, no dominio; el
  anti-patrón "pestaña Documentos").
- **Menos no.** Money sobrevive por extensibilidad (#4). Desk ≠ Planner
  (triaje-ahora vs planificar); el "Time merge" sigue muerto.
- **Matiz:** no son 4 de la misma especie. **Desk es un digest** (cross-concern,
  no posee datos), las otras 3 son lentes-concern. → **1 digest + 3 lentes.**

## B — ¿Nombres? → **fitness (que no mientan), no simetría**

- **Desk** gana **pill propio** (es el digest, no una lente-par); el "view as"
  agrupa solo las 3 lentes. (Hasta el i18n ya trata "Desk" como palabra-marca sin
  traducir en los 3 idiomas.)
- **Desk · Planner · Conversations** se quedan. *Conversations* es el favorito y
  con razón: nombra **lo vivo** (la conversación en curso), no el contacto muerto.
- **Money → renombrado.** Concepto raíz `accounts`. Etiquetas por *idiom*, no por
  palabra literal (*do the books / echar cuentas / faire les comptes*):
  - **EN `Books`** · **ES `Cuentas`** · **FR/CA `Comptes`**
- **Veneno a evitar en todo idioma:** `Fiscal` / `Contabilidad` / `Comptabilité`
  (palabra del gestor) y `Numbers` / `Números` (deja de decir "dinero" y te lo
  quita para una futura lente de datos/aforos).
- **Profundidad del rename = decisión de impl** (ligera: concepto+etiquetas+docs,
  ruta física `/api/money` intacta · profunda: renombra rutas/tablas/tipos). El
  usuario nunca ve la ruta → "coherencia" es sobre todo del constructor.

## C — ¿Qué muestra Books? → **alrededor del bolo**

1. **Spine:** filas = **bolos**, no secciones-tipo. Mata la duplicación (el fee
   aparecía en totals + by-line + fees).
2. **Entidad:** des-fusionar `performance` → **bolo** (dinero) + **función**
   (calendario/road sheet).
   - **bolo = 1 sitio + 1 contrato + 1 fee/pagador/factura, 1..N funciones**
     (pases mismo día o días seguidos en ese sitio).
   - **Discriminador:** *cambia el dinero o cambia el sitio → es otro bolo.*
   - **gira = `kind` de línea**, NO un nivel nuevo (una gira exige ≥3 municipios
     teatro / ~2 música-danza-circo; un bolo de 2 funciones no es gira). Marco
     miraba un piso demasiado arriba; el hueco estaba *dentro* del bolo.
   - Simetría que valida las 2 lentes: **Money = filas de bolos**, **Planner =
     filas de funciones**.
3. **Factura:** Books = **proforma + estado + handoff**. Se **para antes** de la
   emisión legal certificada. Emitir la factura *es* trabajo de la compañía (no
   del gestor), pero hacerlo *desde Hour* convierte a Hour en "software de
   facturación" → Verifactu (ES) / Factur-X·Chorus Pro (FR) = **última milla,
   diferida por país**.
4. **Internacional — el modelo de tasas:**
   - **tasa = línea de tipo con signo:** `{ etiqueta · tipo% · signo (+/−) ·
     exento?(motivo) }`. IVA = +10/21%, IRPF = −15/7%, intracomunitario/export =
     exento(0)+motivo. **España es solo un preset de tasas; Francia será otro.**
   - **Núcleo `bolo/fee/cobro` SIN impuestos** (sabe de moneda, no de fiscal). El
     impuesto vive en la **capa proforma/factura, country-scoped**.
   - "exento" ≠ 0 cosmético: modélalo como tasa exenta **+ motivo** (el matiz
     legal fino es de la capa-país diferida).
   - Palabra: el genérico es **`tax_line`** ("tasa" vale como copy, pero el modelo
     no debe jurar que un IRPF es una "tasa" en sentido fiscal estricto).
   - **Corte por país en 2 sub-niveles:** (a) *preset* de tasas + reglas de
     exención · (b) *emisión legal*. **Cero migración del núcleo** al llegar Francia.
5. **Números (héroe):**
   - **Por bolo:** titular = **precio de venta (bruto)**; 2ª línea = **cobro
     efectivo (neto de tasas)**; + estado (facturado / cobrado / **vencido**).
   - **Cabecera, por moneda:** **Vendido (Σ bruto)** líder + **Pendiente/vencido
     (Σ neto por cobrar)** como número-acción; *pipeline* (holds) a 3er plano.
   - **owed & overdue** = capa de *acción* (a quién persigo) sobre el neto →
     vencido genera **tarea a Desk**.

---

## Estado actual de `feat/money-v3-build` (verificado 2026-07-23)

**Ya construido (✓ alineado con el grill):**
- Tabla `bolo` (`migr. 20260722102000_money_v3_bolo.sql:22-52`): fee **en el bolo**
  (`fee_amount/fee_currency`), `country char(2)`, `venue_name/city`,
  `project_id NOT NULL`, `line_id`/`conversation_id` nullable. `performance` gana
  `bolo_id` (FK). Cadena `conversation → bolo → performance`. Backfill N=1 hecho.
- Fee **eliminado de `performance`** (DROP), `invoice_line`/`expense`/`payment`
  re-anclados a `bolo_id`. RPCs `create_bolo`/`update_bolo_fee`/`delete_bolo`
  (gated `edit:money`), `list_money_bolos`.
- API `/api/money/bolos` (GET/POST + `[id]` PATCH); la vieja `/performances`
  borrada. La vista Money **ya lee bolos**, agrupa por obra, muestra
  pipeline/contracted/collected/pending (todo bruto).

**NO construido (✗ divergencias con el grill):**
- **Tasas hardcodeadas España.** `invoice` tiene `vat_pct/vat_amount/irpf_pct/
  irpf_amount` fijos (`db-types.ts:1115-1205`); **sin `country` en la factura**,
  **sin `tax_line` genérica**, sin impuesto por línea. `create_invoice_from_bolo`
  computa `total := subtotal + vat − irpf` inline
  (`20260722104500_..._invoice_issue.sql:146-157`). → **hace justo lo que #5
  prohíbe.** ⚠️ Corrección de rumbo.
- `fiscal_identity.default_vat_pct/default_irpf_pct` **existen pero no cableados**
  al alta de factura.
- **Sin owed/overdue** en la lente. La maquinaria de *aging* existe en
  `money.ts:171-260` pero **no se importa** en la vista.
- **"net" actual = fee − gastos**, NO neto-tras-tasas. El neto del grill no existe.
- **i18n:** sigue `Money/Dinero/Diners`; **sin francés** (`index.ts` solo en/es/ca);
  las strings de la vista Money están **hardcodeadas en inglés**, no pasan por
  `t()`; "bolo" no está en ningún diccionario.
- **Desk pill:** Desk sigue como 4ª pestaña en `LensSwitcher`.

---

## Plan de acción

### FASE 0 — Corrección de rumbo del modelo de tasas (antes de mergear money-v3)
> El momento más barato de deshardcodear España es **ahora**, antes de que la
> factura tenga datos/dependientes. Es la costura del #5 como frontera de datos.

- [ ] Migración: **`invoice_tax_line`** `{ invoice_id, label, rate_pct, kind
      (add|withhold|exempt), amount, exempt_reason nullable, ordinal }`. Deprecar
      `vat_pct/vat_amount/irpf_pct/irpf_amount` del header (o dejarlas derivadas
      durante la transición).
- [ ] Añadir **`country char(2)` a `invoice`** (snapshot del bolo/workspace) → la
      factura conoce su régimen.
- [ ] Reescribir `create_invoice_from_bolo`: acepta lista de tax_lines (o aplica
      **preset por country**); `total := subtotal + Σ(signed applicable)`.
- [ ] **Preset España** = `{ IVA add X%, IRPF withhold Y% }` desde
      `fiscal_identity.default_vat_pct/default_irpf_pct` (cablearlos, existen ya).
      Exento = tax_line `kind=exempt, rate 0, motivo`.
- [ ] Reglas duras `CLAUDE.md`: backup/preflight proporcional, regenerar tipos,
      **tests RLS**.
- [ ] *(Verificar)* que el schema respeta **1 factura/1 pagador por bolo** (hoy la
      relación bolo↔invoice no lo impone claramente).
> **Decisión pendiente de Marco:** ¿plegar esto **dentro** de money-v3 antes de
> mergear (recomendado), o mergear money-v3 con vat/irpf y hacer tasas como
> *fast-follow* antes del 2º país? Recomendado: dentro, para no migrar el núcleo
> luego (lo que #3 quiere evitar).

### FASE 1 — Contenido de Books (aditivo, tras Fase 0)
- [ ] **Neto-tras-tasas por bolo** (requiere tax_lines/preset): 2ª línea bajo el
      bruto.
- [ ] **owed & overdue:** cablear el *aging* de `money.ts` en la lente; total
      **Pendiente/vencido por moneda**; vencido → **tarea a Desk**.
- [ ] **Re-encuadrar cabecera:** **Vendido (Σ bruto)** líder + Pendiente/vencido
      acción; *pipeline* a 3er plano.
- [ ] **Ficha de bolo:** titular bruto + neto secundario + estado
      (facturado/cobrado/vencido).

### FASE 2 — Naming Books (independiente, puede ir en paralelo)
- [ ] i18n `lens.money`: **en `Books` · es `Cuentas` · ca `Comptes`**.
- [ ] Pasar las strings de la vista Money por `t()` (hoy hardcoded EN) y añadir
      vocabulario **bolo/función** a los diccionarios.
- [ ] **Desk pill:** sacar Desk del `LensSwitcher`; darle afordancia de casa
      (reconciliar Hall `/h` vs Desk `/h/desk`). *(Cross-lens, pequeño.)*
- [ ] Concepto `accounts` en docs/copy. **Rename físico de ruta = diferido/opcional.**

### FASE 3 — Diferido a propósito (documentar, NO construir)
- Emisión legal por país: **Verifactu** (ES, oblig. IS 1-ene-2027 / autónomos
  1-jul-2027; multa ≤50k€/ejercicio por software no conforme) · **Factur-X /
  Chorus Pro** (FR, recibir 1-sep-2026 / emitir PYME 1-sep-2027; TVA multi-tipo).
  Cada uno "el día que abramos el país".
- **Locale francés** (`fr.json` + registrar en `index.ts`) — cuando toque Francia.
- Presets de país adicionales.
- **Contenido C de Desk / Planner / Conversations** — no se grilló; otra sesión.
- **Cristalización en `_decisions.md`** (ADR: money-v3 re-anclado + tasas + rename
  Books + Desk-pill + bolo/función/gira-kind) — **pendiente del OK de Marco**.

---

## Fuentes (terminología + regulación)
- Bolo (una o varias funciones, vs gira): es.wikipedia.org/wiki/Bolo_(interpretación);
  umbral de gira ≥3 municipios teatro: Red de Teatros de Madrid.
- Quién factura / IVA 10-21 / IRPF 15-7: sympathyforthelawyer.com (facturar
  actuaciones artísticas).
- Verifactu ES 2027, ≤50k€: reixmor.com / muaytax.com.
- Facturación electrónica FR spectacle vivant 2026-2027 (Chorus Pro, TVA
  multi-tipo): breakly.io, movinmotion.com, tiime.fr.
