# Money v3 — design brief / prompt (ADR-086)

> Prompt que Marco pega en su app de diseño para producir el diseño de money v3.
> Fuente de verdad estructural: `_notes/spec-money-v3-decisions.md` + `_decisions.md § ADR-086`.
> Lenguaje visual extraído de `apps/web/src/styles/tokens.css`, `base.css`,
> `IdentityMark.svelte`, la Money lens (`/h/money`), `MoneyInvoices.svelte` y el
> road sheet público (único house-style tipo documento que ya existe).
>
> **Es un solo documento con un preámbulo compartido + tres partes (A/B/C).**
> Se puede pegar entero, o pegar `PREÁMBULO + una parte`. **Parte A (el PDF) es
> camino crítico: desbloquea todo lo demás.** El orden a ejecutar es A → B → C.
> El copy de la UI va en inglés (la app ya está en inglés); el brief también.

---

## ═══ PREAMBLE — read first, applies to every part ═══

You are designing three deliverables for **Hour**, a multi-tenant B2B SaaS for
small live-performing-arts companies (theatre, music, dance). It replaces the
scattered Excel/Drive/email/Notion/WhatsApp stack. This brief is about its
**Money** area, which is being restructured (money v3). Match the existing house
style below **exactly** — do not invent a new visual language.

### The one idea behind money v3

Money stops revolving around the invoice. **A gig's fee is the anchor. Getting
paid and issuing an invoice are two independent facts.** You can record a payment
against a fee with no invoice at all. The invoice becomes an *optional document*
that references the same fee. "Collected" is derived from payments-against-fee,
never against the invoice.

Invoicing is a per-workspace module with three modes:
- **off** — no document is issued; money is still recorded (fees, payments, expenses).
- **interno** — a document with its own numbering; the legal invoice is issued
  elsewhere. This document is called a **Proforma**. Does not require the
  receiver's tax data.
- **legal** — Hour *is* the billing system; full legal document. Called a **Factura**.

### Scope guard — stay inside "size A"

Design a clean **money book** (money in = decoupled payments, money out =
expenses, anchored to gig/line/project, with per-currency balances) and an
**optional invoice document**. Do **NOT** design any of: profit & loss, accounting
categorisation dashboards, payroll / money-to-artists, an organisation directory,
or a multi-company fiscal directory. If you find yourself drawing a ledger,
journal entries or a P&L, you have overshot.

### House style (this is Hour's real design system — use these values)

**Two-axis theming.** `data-mode` = light | dark (design **both**). Default theme
`editorial-sobrio`. Colours authored in **OKLCH**, not hex.

**Palette (light mode):**
- Page canvas `--base: oklch(97.5% 0.005 85)` — warm cream. Dark: `oklch(21% 0.008 85)` warm off-black.
- Ink / body text + borders `--neutral: oklch(28% 0.012 275)` — cool near-black. Dark: `oklch(82% 0.006 275)` off-white.
- Brand hue `--primary: oklch(35% 0.13 275)` — cool slate. **Reserved for focus rings, links, selection — NOT button fills.** Dark: `oklch(72% 0.1 275)`.
- Raised surfaces `#fff` (cards); sunk panels a hair darker; borders are neutral at 9% (light hairline) / 18% (normal).
- Status: `--info oklch(52% 0.14 255)` · `--success oklch(50% 0.13 150)` · `--warning oklch(55% 0.14 70)` · `--danger oklch(55% 0.17 25)`.
- Buttons: **primary button = ink fill** (the neutral text colour), not the slate. Secondary = outline. Danger = danger hue.

**Type:**
- `--font-display: "Newsreader", Georgia, serif` — headings, wordmark, **money totals**. Roman + italic, weights 400–600. Headings line-height 1.05, letter-spacing −0.02em, `text-wrap: balance`.
- `--font-sans: "Inter", system-ui` — body & UI. Weight 400, line-height 1.55.
- `--font-mono: "JetBrains Mono", ui-monospace` — **all metadata: eyebrows, dates, codes, badges, amounts.** `font-variant-numeric: tabular-nums` on every number. Tracking 0.02em; eyebrows uppercase, tracking 0.14em.
- Fluid scale, anchor body 14→16px, major-third. Headings clamp from ~1.8rem (h1) down.

**Spacing / shape:**
- Spacing scale xs 4–6px · s 8–12 · m 14–18 · l 20–30 · xl 30–44 · xxl 44–64.
- Radius: s 4px · m 6px (default) · l 10px · xl 14px · circle 999px.
- Shadows: `0 1px 2px black@6%` (1) · `0 2px 6px black@10%` (2) · `0 8px 24px black@14%` (3).
- Content column `--page-width: 900px`; documents use a **narrow centred measure (~40rem)**.

**Signature patterns (copy these — they are what makes it look like Hour):**
- **Eyebrows**: short uppercase mono label above a section (e.g. `MONEY`, `SCHEDULE`), often with a bottom **hairline** rule spanning the section.
- **Masthead**: an italic Newsreader `<h1>` title, with a mono place/date line under it.
- **Identity mark** (`IdentityMark`): a small rounded tile (radius ≈ 28% of size) tinted from a 12-colour accent palette — `bg = mix(accent 16%, surface)`, `fg = oklch(from accent, L 0.42, keep c/h)`, subtle inset ring at 26%. Holds a 1–3 letter monogram (tabular, weight 600). The old round colour dot is retired — use the tile.
- **State badges**: border-only, lowercase, mono lifecycle pills. Tones: neutral / info / success / warning / danger / faint.
- **Tables**: quiet, hairline row separators, mono for dates/codes/amounts, Newsreader or ink for names.
- **Tax breakdown**: a small `<dl>` of Subtotal / VAT / IRPF / Total, each figure in a faint-filled cell, tabular-nums.
- **Empty states**: a single muted line in `--text-faint`, e.g. *"No invoices yet — create one from a gig's fee above."*

**Reusable components you can assume exist** (design to them, don't reinvent):
Button (primary/outline/danger, sizes xs–l), Input & Select (cream field, radius
4px, primary focus ring), Checkbox/Radio, Dialog (native, sizes 24/32/48rem,
rounded 10px + shadow 3), Menu (dropdown), StateBadge, Badge, Chip, Pill,
Avatar, Toast (bottom-right, left accent bar), Tooltip.

**Deliver every screen in light + dark, and in all relevant states**
(empty / loading / error / filled). Mobile matters: the Money lens and forms are
used on phones; the invoice document is A4/print-first but must also read on screen.

---

## ═══ PART A — Invoice / Proforma document (PDF house-style) ═══ [CRITICAL PATH]

Design the **printable document** Hour emits for a gig's money. This is the
piece that unblocks everything else. There is **no** such document today; the
closest existing reference is Hour's public road sheet — a narrow centred measure
(~40rem), Newsreader italic masthead, mono uppercase section eyebrows with
hairline rules, mono for all metadata. Carry that DNA into the invoice.

Two variants of the same document, chosen by the workspace's invoicing mode:
- **FACTURA** (mode = legal) — full legal invoice; requires issuer + receiver tax data.
- **PROFORMA** (mode = interno) — same skeleton; own numbering; receiver may be
  just a name (no tax data required); carries a discreet *"Proforma — not a valid
  fiscal invoice"* note.

### Print requirements

- **A4 page**, generous but not wasteful margins, single centred column.
- **Print-safe**: must be fully legible in black & white. Never encode meaning in
  colour alone. Use `print-color-adjust: exact` only for the faint total-cell fill;
  everything structural must survive greyscale. Keep ink coverage low (it's cream
  on screen, white paper on print).
- Also render cleanly **on screen** as a preview before issuing.
- Design **draft vs issued** states: a **draft has no number** (show `DRAFT`,
  muted) and a *watermark or corner tag* reading DRAFT; an **issued** document
  shows its correlative number and is visually "final".

### Document structure (top → bottom)

1. **Masthead**
   - Document type as a mono uppercase eyebrow: `FACTURA` / `PROFORMA`.
   - **Number** in mono (e.g. `2026-0042`), or muted `DRAFT` if not issued.
   - Dates row (mono): Issue date · Due date (contractual) · Expected collection.
   - Optional issuer logo/monogram (the IdentityMark tile) — small, top corner.

2. **Issuer block** ("From") — snapshotted from the issuer's fiscal identity:
   legal name (Newsreader), tax id, structured address (line 1, line 2, postal
   code · city · region · country), IBAN, SWIFT/BIC. Mono for tax id / IBAN / SWIFT.

3. **Receiver block** ("Bill to") — snapshotted from the receiver's fiscal
   identity: legal name, tax id, structured address. **In proforma this may be a
   bare name** — design that degraded state too.

4. **Line items table** — one or many lines (a tour can bill several gigs on one
   invoice). Columns: Description · Qty · Unit price · Line total. Auto description
   pattern: *"Project — Venue, City — date"*. Mono for numbers, right-aligned,
   tabular-nums. Show both the common **single-line** case and a **multi-line** case.

5. **Totals block** — a `<dl>` in Spanish fiscal form, right-aligned, in a faint
   cell, Newsreader for the final total:
   - Subtotal
   - VAT (IVA) *x%* — additive (+)
   - IRPF *x%* — subtractive (−)  *(may be absent → hide the row)*
   - **Total** = Subtotal + VAT − IRPF
   - One currency per document — show the currency code (mono). **Never mix currencies.**

6. **Footer** — payment details (IBAN / SWIFT, repeated compactly), payment
   condition / terms note, and for legal mode a small legal footnote area. For
   proforma, the "not a valid fiscal invoice" note lives here.

### Sample data to render (use it — concrete data → better design)

- Issuer: **MüK Cia SL** · tax id `ESB12345678` · Carrer Example 12, 2n 1a ·
  08001 · Barcelona · Catalunya · España · IBAN `ES91 2100 0418 4502 0005 1332` · SWIFT `CAIXESBBXXX`
- Receiver: **Teatre Municipal de Girona** · tax id `P1708500A` · Plaça del Vi 1 · 17004 · Girona · Catalunya · España
- Line: *"Fetitxes — Teatre Municipal, Girona — 14 Mar 2026"* · qty 1 · unit 2 900.00 EUR
- Subtotal 2 900.00 · VAT 21% +609.00 · IRPF 15% −435.00 · **Total 3 074.00 EUR**
- Number `FAC 2026-0042` · issued 20 Mar 2026 · due 20 Apr 2026

Deliver: **Factura (issued)**, **Factura (draft)**, **Proforma (issued)**, and a
**multi-line** variant. Plus the on-screen preview framing (how it sits inside the app before issuing).

---

## ═══ PART B — Fiscal identity forms + invoicing settings ═══

Design the forms that feed Part A. A **fiscal identity** = "the tax details of one
legal party". Same field set, two ownership contexts, asymmetric use:

### B1 · Issuer identity (account-owned — *your* billing identity)

Full form. Group into sections, each led by a mono eyebrow + hairline:
- **Identity**: `label` (distinguishes "MüK SL" from "María freelance"), `legal_name`, `tax_id` (generic, label it "Tax ID" not "NIF").
- **Address** (structured, **not** a free-text block): `address_line_1`,
  `address_line_2` (floor/door, manual), `postal_code`, `city`, `region`,
  `country`. Add a muted helper: *"Address autocomplete coming later"* — design
  the manual fields now.
- **Banking**: `iban`, `swift_bic` (IBAN is SEPA-only; SWIFT covers the rest).
- **Tax defaults**: `default_vat_pct`, `default_irpf_pct` (as % inputs).

### B2 · Receiver identity (workspace-owned — a venue/payer)

**Asymmetric, lighter form**: Identity + Address only. **No banking, no tax
defaults** (those fields are unused on the receiver side). In non-legal modes the
receiver can be just a typed name — design a minimal "just a name" affordance vs
the full receiver form.

### B3 · Wiring & selection

- An account picks its **default issuer identity**; a workspace can **override**
  with its own issuer identity (freelance case: the person, not the workspace,
  bills). Design a compact selector for "which identity issues from here",
  showing the resolved default and the override.
- A place to manage the **list** of fiscal identities (issuer(s) you own +
  receiver(s) you've entered): a quiet list with the IdentityMark tile, label,
  legal name, tax id; add / edit / archive.

### B4 · Invoicing mode setting

A workspace setting `invoicing_mode ∈ {off, interno, legal}` (same shape as an
existing "booking mode" toggle). Design the control + a one-line explanation of
each mode's consequence (off = record money only; interno = issue Proformas;
legal = issue Facturas). Changing it changes which document Part A produces.

States for all B screens: empty (first-time create), filled (edit), inline
validation errors (e.g. malformed tax id / IBAN), saving/loading, light + dark, mobile.

---

## ═══ PART C — Money lens (v3 screens) ═══

Redesign the **Money lens** at `/h/money` so the fee is the anchor and payment is
decoupled from the invoice. The current lens is a single centred column (~900px),
scoped by workspace/line pins, stacked top→bottom. Keep that spine; change the
model underneath.

### Current stack (money v2 — what exists)

1. **Header** — `MONEY` eyebrow + lens switcher, then **per-currency total cards**
   (one card per currency, never summed together) showing *pipeline / invoiced / collected*.
2. **By line** rollup — clickable rows per line: accent glyph + name + project,
   per-currency confirmed amount, optional `− expenses` / `net`, a two-tone
   progress bar (confirmed+holds tint vs solid confirmed), "N confirmed dates".
3. **Fees table** — Date · Project · Where (venue · city) · Status badge · Fee
   (inline-editable) · Actions (an outline **Invoice** button per gig).
4. **Invoices list** — collapsed rows expanding to a detail panel (dates, aging
   with provenance, payment condition, collected progress bar, Record-payment
   dialog, payments list, tax breakdown, status menu).
5. **Expenses list** — date · category · description · amount, per-currency totals.

### What money v3 changes (design these)

1. **The fee row becomes the anchor.** Each gig's fee shows its own **collected**
   state (a progress bar of payments-against-fee) **independent of any invoice** —
   a fee can be fully collected with zero invoices. Surface: fee amount · collected
   / fee · remaining.

2. **"Record payment" is promoted to the fee/scope level**, not buried inside an
   invoice. A payment can anchor to a **gig, a line, or a project**, and carries a
   **counterparty** and a **category**. Design the **Record payment** dialog:
   amount · currency · received-on · method · reference · **counterparty** ·
   **category** · and an **optional** "link to invoice" (nullable — usually empty).

3. **Invoice becomes optional and mode-aware.** The per-gig action reads
   **Create invoice** (legal) or **Create proforma** (interno), and **disappears
   entirely when mode = off**. The created document references the fee (Part A).
   The old "collected lives inside the invoice" panel is gone — collected is now a
   fee-level fact; the invoice panel only shows the *document* (number, dates,
   snapshotted parties, tax breakdown, issue/cancel).

4. **Header totals, reframed**: per currency → *pipeline · collected* always;
   *invoiced* **only when invoicing_mode ≠ off**. Keep currencies strictly separate.

5. **Expenses gain a counterparty** (nullable). Otherwise unchanged.

6. **The "off" experience**: when a workspace never issues documents, Money is a
   clean **book** — fees with collected state, payments, expenses, per-currency
   balances — and shows **no invoice UI at all**. Design that stripped state as a
   first-class layout, not an error.

Deliver: the full Money lens in **legal**, **interno** and **off** modes; the
Record-payment dialog; a fee row in states *unpaid / partially collected / fully
collected*; the invoice detail panel (document-only); light + dark; mobile.

### Anti-goals (do not add)

No P&L, no accounting categories view, no money-to-artists, no org directory, no
cross-company fiscal linking. Category and counterparty are quiet nullable fields,
not a reporting surface. Keep it a book, not accounting software.
