# Hour — Design: access + comms (who is who, and where they talk)

> **STATUS: MODEL DECIDED IN GRILL, NOT IMPLEMENTED — zero schema.** Two design passes
> run (2026-07-19 and 2026-07-20). The model questions this pass existed to answer are
> **closed**; what remains is listed under § Still open. Hard gate standing: use the app
> for a real difusión season before building any of it.
>
> **Read first:** `_notes/spec-access-comms-decisions.md` — the complete decision record.
> This file is the *design* contract; that one is the *model*. Where they disagree, the
> decision record wins and this file is the bug.
>
> Prototypes that embody it, all `<link>`ed to the REAL `apps/web/src/styles/base.css`
> so they cannot drift from the token file, light + dark:
> - `app design/performance-page-prototype.html` — **the newest and most decided**: the
>   gig page, with the comms hub as one section of it
> - `app design/permissions-editor-prototype.html` — rols · level · the level-aware matrix
> - `app design/person-roles-org-prototype.html` — several rols, several organisations
> - `app design/operator-invite-flow-prototype.html` — contact → operator
> - `app design/comms-hub-performance-prototype.html` — the hub full-screen (superseded by
>   the gig page for layout; kept for the audience/roster detail)
>
> Do NOT inherit from `build/design-prompt.md` — stale (House/Room/Run/Gig, two-axis
> sidebar, 8 accents; all superseded).

## What Hour is, visually

Calm, editorial tool for live performing arts. Newsreader (serif, often italic) for titles
and figures · Inter for body · JetBrains Mono for micro-labels, dates, hours and states.
The serif/mono contrast IS the identity.

Light is primary, dark is an equal contract — design both. Real tokens:
`--bg oklch(97.5% 0.005 85)` / ink `oklch(28% 0.012 275)` in light; `oklch(21% 0.008 85)` /
`oklch(82% 0.006 275)` in dark. Twelve project accents at `oklch(60% 0.13 H)`,
H = 260, 45, 150, 20, 330, 200, 295, 85, 125, 185, 235, 355.

**Non-negotiable:** zero pictographs anywhere, including the theme toggle — typeable
characters only (→ · › ⋯ + —). Colour = state, never decoration; red only for genuinely
overdue or in conflict. Outline = possibility, solid = commitment. Truth-only microcopy:
every string maps to a real field. UI copy in Catalan, plain and spoken. Nothing clipped.

**Identity marks:** a project carries a monogram — 1–3 letters in mono on a rounded square
tinted with its accent (bg = accent 16% over white, text = same hue at L 0.42). A person
gets the same silhouette as a **circle with no hue**: initials in muted ink. Colour belongs
to containers; if people took accents a thread would run two colour systems.

## El bastidor — the frame (converged, do not reinvent)

Three rails: **left** marginalia (one mono small-caps label per group, a hairline down the
group, the label is a link) · **centre** the score (limited measure, one clean line per
object, related rows tight enough to read as one body, big air only between real subjects)
· **right** the rail.

**What the rail carries is per screen** — this is the correction of 2026-07-20 and the most
important thing in this file. A *validation artifact* put "who sees this and why" in the
rail because that was what was being tested. **The product must not.** The criterion:

> **centre = what you ACT on, and what changes · rail = what you LOOK UP, and what is
> simply true**

On a gig page the rail is the venue, the people, the road sheet and the fee. The
permissions roster is a **door** from the rail, not the rail — you read threads fifty times
a day and check who sees them three times a month, and a permanent panel of who is watching
has a low-grade surveillance feel that fights the calm.

**One thing may never be folded away:** the per-thread audience line ("Ho veuen 5 — per
permís de logística"). Once the roster is behind a door, that line is the only thing
carrying ADR-083 §5's transparency, and it sits exactly where the answer is needed — right
before you write.

**One colour axis per screen.** On the gig page the section gutters are neutral ink and
tint is reserved for facets.

### The 144px void — a real trap, not a style preference

`base.css` gives every top-level `<section>` the document default
`padding-block: var(--section-padding-block)` (~72px) + `padding-inline: var(--gutter)`.
That is editorial rhythm for the login and public pages; inside the app it injects ~144px of
dead air between two consecutive sections. **This was a large part of why the first pass read
as "a lot of vertical space, something missing."** The app already opts out
(`.shell__content :where(section:not(section section)) { padding-block: 0; padding-inline: 0 }`).
Any prototype must reproduce the opt-out or it lies about the app's rhythm — `app design/_kit.css`
now does.

## The model

Containers nest: **space** (company) → **project** (show) → **line** (tour / booking season /
creation) → **performance** (one gig, "bolo").

Three things that must never fuse on screen:

| | | |
|---|---|---|
| **rol** | the label: what a person does. Multiple. Standard + custom. | **no power** |
| **membership** | which containers they are in | decides what they SEE |
| **permisos** | per facet: `res \| veure \| veure+editar` | decides how much |

**Presets, never a capability composer: Mínim · Equip · Coordinació · Direcció.**
(Renamed 2026-07-20: `Convidat` → `Mínim`, because "convidat" now names a *person*;
`Producció` → `Coordinació`, because a preset must not share its name with a rol —
it invites "give her the Producció preset because she does producció", the exact
rol/permisos conflation the model forbids.)

### Facets exist per container level

|  | espai | projecte | línia | bolo |
|---|:--:|:--:|:--:|:--:|
| Converses | ● | ● | ● | — |
| Materials | — | ● | ● | ● |
| Tècnica | — | ● | ● | ● |
| Logística | — | — | ● | ● |
| Full de ruta | — | — | — | ● |
| Diners | ● | ● | ● | ● |

- **`General` is not a facet** and never a matrix row: it is membership in the container.
  Its thread always exists and its audience is exactly the container's members.
- **Absent ≠ denied.** A facet that does not exist at a level is not "set to res" — it is
  not there. Say it in those words.
- **Diners is the only facet at all four levels.** That is why it is the sensitive one.
  Never smooth it away.
- Effective access is the **union** across levels, unchanged.
- Honest accounting to keep visible: the ergonomic gain is modest (2 / 4 / 5 / 5 rows;
  línia and bolo differ only in Converses ↔ Full de ruta). **The gain is safety, not
  brevity** — you cannot grant Full de ruta at space level because the row is not there.

### The invitat — a membership minus login

**An `invitat` is a membership with permissions, minus a login, plus an end date.** Not a new
mechanism: same containers, same facets, same view/edit axis. ADR-082 §6 survives literally —
*login only for operators* — what falls is the tacit assumption that being **inside** required
a login. The wall was never membership; the wall is the login and the seat.

Reached by signed link, no account, **consumes no seat**. **Can write, and is part of the
thread.** Sees the full history of the threads they are in. Invited to **facets in a
container**, not to individual threads — so future threads in those facets include them.
**A free thread never inherits guests**: it always has its own explicit list. May be invited
into facet threads including Diners. **Revoking is not erasing.** The invitation always
carries an end, defaulted from the container when it has a date, chosen explicitly when not.
Always visible in "who enters and why", with who invited them and when.

Audience of any thread = **derived(facet, container) ∪ invited** — one formula for both kinds,
a free thread's derived set being empty.

### Delegation — bounded by the delegator

You can only grant what you hold, on all three axes: **facet · verb · level**. And what you
hold is the **ceiling, never the default** — the default of any invitation is `Mínim`, and
every facet above it is switched on by hand. Granting Diners to a guest carries an explicit
confirmation line. This rule **replaces** the separate "invite" capability gate.

## The screens

1. **The gig page** — masthead, then the **schedule** (venue-local, time as glyph, the show
   itself in serif), the **comms hub as one section** (one line per thread + its audience
   line), and the gig's **tasks**. Rail: the venue and its contact, who is coming (including
   the guest with a dashed ring and her end date), the road sheet, the fee.
   **The "outside the wall" band is gone and must stay gone** — each person sits in the block
   they belong to: the venue's producer under *La sala*, the guest in *Qui ve*, the programmer
   nowhere on the gig at all. The band was the symptom of one undifferentiated list.
2. **Assigning permissions** — rols → level → the level-aware matrix (with a column showing
   where each facet exists) → the effective view with provenance per line. Overrides marked
   and attributed. Capabilities that do not fit the matrix in a separate block.
3. **A person, several rols, several organisations** — organisations as relations with dates
   including a finished one; conversations showing all three anchors (org+person / org only /
   person only); access as **one row per link** (person × container): a door where there is
   work, none where the relationship is booking outreach.
4. **Contact → operator** — the door on the link, the invitation, pending, accepted (seat
   counted), and the door that must never exist. Plus the **guest** using the *same editor*,
   differing only in no-login, an end date, and the inviter's ceiling applied to the matrix.

## Still open — do not resolve silently

1. **Revoking has no screen.** An operator stops being one at the end of a tour: access
   closes, the person returns to contact, everything they wrote stays. This is the other half
   of "dar de alta" and nobody has designed it. **Highest-value thing left to draw.**
2. **The concern palette vs the facet palette.** The Desk tints per concern, comms tints per
   facet, they overlap on Diners, and no single decision reconciles them.
3. **Does comms surface in the Desk?** A `MISSATGE` run fits the grammar, but 4→5 concern
   labels costs calm and "everything unread" turns the Desk into an inbox. Proposed criterion
   if it does: only a message carrying an open question addressed to you.
4. **`roadsheet_share` expiry** — it is revoke-only today; whether it should follow the
   guest's rule.

## Deliverable, if regenerating

The four screens, light AND dark, mobile for the gig page (it is read standing up on a
load-in day), realistic Catalan data. Plus the empty hub (calm, not broken) and the
money-masked state (**suppressed silently — masked ≠ zero, never a locked box**).

Open with one short paragraph: what you changed, and what you decided that you were not
told to decide. The 2026-07-20 pass decided the facet list in an italic caption; anything
decided must be said out loud, in an annotation block visibly not interface.
