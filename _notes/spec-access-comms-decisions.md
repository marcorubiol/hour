# Access + comms — decision digest (grill 2026-07-19 → 2026-07-20)

> **Status: DECIDED IN GRILL, NOT IMPLEMENTED. Zero schema touched.**
> This file is the working record of what Marco and .zerø settled after ADR-082 /
> ADR-083 were written. It exists so the decisions survive the conversation.
> **It is a staging file, not the canon** — the canon is `_decisions.md`. Once
> folded in (ADR-085 + amendments to 082/083), this file can be deleted.
>
> Hard gate still standing: use the app for a real difusión season before building
> any of this.
>
> Design artifacts that embody these decisions: `app design/*.html`
> (`performance-page-prototype.html` is the newest and the most decided).
> Design contract for the tool: `build/access-comms-design-prompt.md`.

## 1 · Naming (closes ADR-082's naming note, extends it)

| term | means | note |
|---|---|---|
| **rol** | the label: what a person DOES. Multiple, standard + custom. **No power.** | unchanged from ADR-082 |
| **permisos** | the access: per facet, `res \| veure \| veure+editar` | unchanged |
| **operador** | a person with a login. Occupies a seat. | unchanged |
| **invitat** | a person WITHOUT a login who is nonetheless inside. **New.** | § 3 |

Preset renames, forced by collisions:
- `Convidat` → **`Mínim`** — "convidat" now names the guest (a person), and the
  lowest operator preset cannot share the word with it.
- `Producció` → **`Coordinació`** — `Producció` becomes a *facet* (§ 2), and it is
  already a *rol*. Three meanings for one word is exactly the ADR-082 §2 failure.

Final preset ladder: **Mínim · Equip · Coordinació · Direcció**.

## 2 · Facets exist per container level

The two lists that ADR-082 and ADR-083 sketched were never two lists — they were
**one list seen at two heights**. ADR-082 gates what lives high (the book, the
materials); ADR-083 talks about what lives low (technical, logistics). Money was in
both because it is the only one that crosses every level.

|  | espai | projecte | línia | bolo |
|---|:--:|:--:|:--:|:--:|
| Converses | ● | ● | ● | — |
| Materials | — | ● | ● | ● |
| Producció | — | ● | ● | ● |
| Tècnica | — | ● | ● | ● |
| Logística | — | — | ● | ● |
| Full de ruta | — | — | — | ● |
| Diners | ● | ● | ● | ● |

- **`General` is NOT in the table.** It is membership in the container: the general
  thread always exists and its audience is exactly the container's members. A
  "General permission" would be false — it can never be `res` for a member.
- **Absent ≠ denied.** A facet that does not exist at a level is not "set to res";
  it is not there. The UI must say so in those words.
- **Effective access is still the UNION across levels** (ADR-082 §3, unchanged).
  `Diners·veure` at space level grants it in every gig. The table says where a
  facet *can* exist; it does not change how access sums.
- **Chosen deliberately over a flat list.** Marco's call. The honest accounting: the
  ergonomic gain is modest (espai=2 rows, projecte=5, línia=6, bolo=6 — línia and
  bolo differ only in Converses↔Full de ruta). **The real gain is safety, not
  brevity**: you cannot grant `Full de ruta` at space level or `Converses` on a gig,
  because the row is not there to grant.
- **Weakest cell: `Producció`.** Kept, but on probation. The mockup pass tested it
  by writing a realistic Producció thread and found every message would have gone to
  tècnica, logística or diners. Note that "it's a classic theatre role" argues for it
  being a **rol** (it already is one) — not for it being a facet. Re-evaluate after a
  real season.

**Reversibility is a requirement, not a nicety** (Marco, explicit): the table above
must be **rows, never code**. Moving Tècnica from projecte to línia has to be an
`UPDATE`, not a migration and not an `if`. Facet list, level table and presets are
all data. What can never be free: a facet only means something if it gates a table,
and that binding lives in RLS policies (today `read:money` appears literally in ~11
places in `rls-policies.sql`). Moving a facet between levels: free. Adding a new
facet: costs its policy. Deleting one that has been in use: costs its history.

**What already exists and helps:** `has_permission(project_id, text)` already
resolves `union(roles.permissions) + permission_grants − permission_revokes` with
roles/grants/revokes as *data* on `project_membership`. That is ADR-082's
preset+overrides engine, already shipped. **What does not exist at all:** any level
other than project. `has_permission` takes a `project_id` and nothing else, and
there is no workspace/line/performance membership. **The level dimension is the
whole build cost of this decision.**

## 3 · The invitat — a membership minus login

Origin: the second design pass invented a venue contact participating in a thread by
signed link. Marco took it as a good idea and it was raised to a decision.

**An `invitat` is a membership with permissions, minus a login, plus an end date.**
Not a new mechanism: same containers, same facets, same view/edit axis. What changes
is only `login = no` + `ends_at`.

This does not weaken ADR-082 §6 — it makes it literal. *"Login only for operators"*
stays true. What falls is the tacit assumption that **being inside required a
login**. The wall was never membership; the wall is the login and the seat.

Settled:
- **Reached by signed link. No account. Consumes no seat** (contacts stay unlimited
  and free — the Phase-1 business model is untouched).
- **Can write, and is part of the thread.** Not a spectator.
- **Sees the full history** of the threads they are in, including messages from
  before they were invited. A sub-thread is one conversation; partial history creates
  references to things you cannot see.
- **Invited to FACETS in a container**, not to individual threads. So future threads
  in those facets include them.
- **A free thread does NOT inherit guests from facets** — a free thread has its own
  explicit list, always. (Discovered in the design pass and worth keeping verbatim:
  *"un fil lliure no hereta els convidats a matèries."*)
- **Can be invited into facet threads, including Diners.** Marco overrode the
  earlier "free threads only" restriction. It does not break audience derivation:
  audience becomes `derived(facet, container) ∪ invited` — one formula for both
  thread types, where a free thread's derived set is empty. **This is simpler than
  the two-mechanism version it replaced.**
- **Revoking is not erasing.** What a guest wrote stays in the thread. It is the
  company's record.
- **Ends with the thing, not with a clock.** The invitation always carries an end,
  defaulted from the container when the container has a date (the gig passes →
  access closes, with a margin of weeks for the invoice/photos tail), chosen
  explicitly when it does not (a free thread on a project). Revocable by hand at any
  time. **This breaks with the house precedent** — `roadsheet_share` has `revoked_at`
  and no `expires_at` — deliberately: a one-way document that ages into irrelevance
  is not the same risk as a live write channel from an unauthenticated URL. Open,
  not now: whether `roadsheet_share` should get the same treatment.
- **Always visible** in "who enters and why", with who invited them and when.

## 4 · Delegation — bounded by the delegator

**You can only grant what you hold**, on all three axes:
- **facet** — you cannot grant a facet you do not hold
- **verb** — holding `veure` you cannot grant `veure+editar`
- **level** — your level or narrower, never wider

**And what you hold is the CEILING, never the DEFAULT.** The default of any
invitation is `Mínim`; every facet above it is switched on by hand. Marco refused to
sign a model where inviting someone "to the gig" could drag Diners in by inheritance.
A guest *can* end up seeing the caché — never by inheritance, only because someone
who holds Diners deliberately gave it, with an explicit confirmation line
("estàs donant la conversa econòmica a algú de fora de la companyia").

Dividend: this rule replaces the separate "invite" capability gate. An admin holds
everything, so an admin can grant everything; a road manager delegates within hers.
One rule instead of two, and the 8am case survives (she can put the venue's
technician into Tècnica/Logística because she holds them; she cannot put anyone into
Diners because she does not).

What the rule does **not** bound is quantity — someone with wide access can create
many guests. With expiry and the visible roster, that is accepted for a 3-15 person
company. Do not build for it.

## 5 · Design decisions that came out of drawing it

- **The frame ("el bastidor") is three rails**: marginalia gutter · limited-measure
  score · rail. It is what turned a vertical pile into a page and it is now the
  app-wide frame, not a screen layout.
- **What the rail carries is per screen.** Correction of 2026-07-20: a *validation*
  artifact put "who sees this and why" in the rail because that was what was being
  tested. The product must not. Criterion: **centre = what you act on and what
  changes · rail = what you look up and what is simply true.** On a gig page the rail
  is the venue, the people, the road sheet and the fee.
- **The permissions roster is a door, not a rail.** You read threads fifty times a
  day and check who sees them three times a month. What stays permanently visible is
  the **per-thread audience line** ("Ho veuen 5 — per permís de logística"), because
  that is where the answer is needed: right before you write. **That line may never
  be folded away** — it is what carries ADR-083 §5's transparency once the roster
  is behind a door.
- **The "outside the wall" band dissolves.** Earlier passes needed a band for derived
  participants who cannot enter. It is unnecessary once each person sits in the block
  they belong to: the venue's producer under *La sala*, the guest technician in *Qui
  ve* (dashed ring + end date), the programmer nowhere on the gig at all — he belongs
  to the difusión conversation. **The band was the symptom of one undifferentiated
  list.**
- **The hub is a section of the gig page, not the page.** What earlier passes drew
  was the hub full-screen with the gig compressed into a header line. At 8am on a
  show day you open a gig for the call times, who is coming and the road sheet; the
  conversation happens *around* that.
- **Person marks carry no hue** (circle, quiet ink); colour stays the container's
  language (ADR-081).
- **One colour axis per screen.** On the gig page the section gutters are neutral and
  tint is reserved for facets. Open: the Desk tints per *concern* and comms tints per
  *facet*; those two palettes overlap on Diners and have never been reconciled in one
  decision.

## 6 · Open, deliberately

1. **Revoking has no screen.** An operator stops being one at the end of a tour:
   access closes, the person returns to contact, everything they wrote stays. Nobody
   has designed it. It is the other half of "dar de alta".
2. **`Producció` as a facet** — on probation, see § 2.
3. **The concern palette vs the facet palette** — one decision, not yet taken.
4. **`roadsheet_share` expiry** — whether it should follow the guest's rule.
5. **Does comms surface in the Desk?** A `MISSATGE` run fits the grammar, but 4→5
   concern labels costs calm and "everything unread" turns the Desk into an inbox.
   Proposed criterion if it does: only a message carrying an open question addressed
   to you.
