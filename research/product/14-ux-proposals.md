# UX/UI — App Structure Proposals

> Last updated: 2026-04-20
> Status: proposals for evaluation — no decision yet
> Context: 6 proposals generated, 2 marked as extremely creative (The Stage, The Rhythm)

---

## Summary table

| # | Name | Metaphor | Navigation | Risk | Wow | Best for |
|---|------|----------|------------|------|-----|----------|
| 1 | The Desk | Tech table | Sidebar + tabs | Low | Low | Safe baseline, scales well |
| 2 | The Timeline | Wall planner | Horizontal timeline + panel | Med | Med | Date-heavy workflows |
| 3 | The Board | Production board | Kanban boards per pipeline | Low | Low-Med | Status-driven workflows |
| 4 | The Map | Tour GPS | Split map + panel | Med-High | High | Heavy touring companies |
| 5 | **The Stage** | Theatre stage | No menu — spotlight + scenes + gestures | High | Very High | Identity-first, memorable |
| 6 | **The Rhythm** | Instrument | Full-screen modes/lenses | Med | High | Culture-aware, warm |

---

## Proposal 1: "The Desk"
*Work station — the Logic Pro of performing arts management*

### Navigation
Dual-mode sidebar (ADR-009):
- **Collapsed:** icons — House, Rooms, Contacts, Calendar, Money, Settings
- **Expanded:** tree hierarchy (House > Room > Lines/Shows/Dates)
- **Top bar:** contextual breadcrumb + global search + active Room selector
- **Command palette** (Cmd+K): first-class citizen

### Information architecture
Hub-and-spoke: Room is the hub. Inside each Room: tabs — Overview / Engagements / Lines & Dates / Production / Money. Cross-cutting views: Calendar and Contacts aggregate all Rooms.

### Primary interaction
Master-detail list. Left column: filterable/sortable list. Right panel: full editable detail. Multi-select for batch actions. Drag & drop only where it makes sense.

### Visual identity
- Density: medium-high. No wasted scroll.
- Palette: warm dark grey (`#1a1a1e`), saturated accent colors for state
- Type: monospace for data, clean sans-serif for text
- Mood: professional backstage. Quiet. Everything at hand, nothing screams.

### Onboarding
Create House > choose usage profile (8 personas) > create first Room with wizard > import contacts > contextual suggestion to start

### Mobile
Bottom-tab nav (5 icons). Lists become push navigation. Quick actions: log call, change status, confirm date. Does NOT replicate full desktop — focuses on consultation and quick updates.

---

## Proposal 2: "The Timeline"
*Everything is time — the timeline as backbone*

### Navigation
- Horizontal timeline (60% of screen). Infinite scroll. Zoom: day > week > month > quarter > year
- Minimal left sidebar: House, Rooms (as timeline filters), Contacts, Settings
- Toggleable bottom panel for selected item detail

### Information architecture
Time is the first dimension. Lanes (tracks) per Room, expandable to sub-lanes. Engagements appear as points/bars. Overlaps and conflicts are immediately visible.

### Primary interaction
Interactive timeline. Click any point > detail panel. Drag to move dates, resize for duration. "Now line" (soft red vertical) marks today. Everything left desaturates slightly.

### Visual identity
- Palette: warm light (`#faf8f5`), auto-generated Room colors (max 8). Past events desaturated.
- Type: humanist sans-serif (Inter/Source Sans). Tabular numbers for dates.
- Mood: living production wall planner.

### Mobile
Timeline rotates vertical (natural thumb scroll). Days as rows. Swipe horizontal between Rooms. Default scroll position = today.

---

## Proposal 3: "The Board"
*Native kanban — each pipeline is a board*

### Navigation
- Top bar: Room selector + board selector (Bookings / Production / Dates / Money)
- Compact left sidebar: only cross-cutting icons
- Each main view is a board with configurable columns

### Information architecture
Room = container of boards. Pre-configured by Room type:
- Difusion: Prospect > Contacted > Negotiating > Confirmed > Declined
- Production: Backlog > In Progress > Blocked > Done
- Tour: TBC > Confirmed > Advanced > Cancelled (with map overlay)
- Invoicing: Draft > Sent > Overdue > Paid

### Primary interaction
Drag & drop between columns (state change = card move). Click card > right panel detail. Quick-actions on hover. Optional swimlanes.

### Visual identity
- Board-type color coding (Difusion=cool blue, Production=amber, Tour=green, Money=grey)
- State encoded in position, not color
- Type: geometric sans-serif (Outfit/Satoshi)
- Mood: Trello/Linear but with backstage personality

### Mobile
Boards as horizontal scroll. Swipe on cards replaces drag & drop (right=advance, left=retreat). FAB for quick-add.

---

## Proposal 4: "The Map"
*Geography first — touring is moving through space*

### Navigation
Fixed split-screen: map (50-60%) + content panel. Map shows venues, tour dates, geolocated contacts.

### Information architecture
Venue is the central visual entity. Clusters on zoom-out. Tour routes drawn as lines on map. Panel is contextual to map selection.

### Primary interaction
Geographic exploration + contextual panel. Route mode: drag points on map to reorder shows. Heatmap mode: activity density by region. Toggle to collapse map for pure list view.

### Visual identity
- Clean map (Mapbox style, no noise). Status-coded pins.
- Type: good legibility at small sizes (map labels matter)
- Mood: tour manager with advanced GPS

### Mobile
Full-screen map with sliding bottom sheet (Google Maps pattern). Offline mode for venues and routes.

---

## Proposal 5: "The Stage" — CREATIVE
*The app as theatre stage — dark, kinetic, moment-centered*

### Navigation
**No sidebar. No menu.** Screen is empty space that fills with context.
- **Spotlight**: opens to ONE thing — the most relevant now (next show, pending follow-up, overdue invoice)
- Navigation by gestures and keyboard: Space=command palette, arrows=navigate scenes, click empty=return to spotlight
- **Dock** (bottom, appears on hover): shortcuts to Rooms, Calendar, search. The "pit" — always available, never invasive.

### Information architecture
Scenes, not pages:
- **Spotlight** (default): what matters NOW. Algorithmic.
- **Reach** (difusion): engagements as constellation — closest to confirmation near center, cold ones at periphery
- **Build** (production): vertical timeline centered on today
- **Road** (tour): map + minimal date panel
- **Count** (money): dense number dashboard

### Primary interaction
Focus + flow. ONE thing at a time with full depth. Cinematic transitions (crossfade). Cards expand in-place (line > card > full sheet). Quick capture (C key). Batch mode (B key) for dense multi-select operations.

### Visual identity
- **Black background (`#0a0a0a`)**. Like a dark stage.
- Elements with subtle warm glow — like objects under a profile spot
- Minimal color: only for state (confirmed=soft green, pending=amber, urgent=contained red)
- Typography: single family, extreme weights (light large titles, medium compact data)
- Animations: smooth ease-out, 200-400ms. Everything moves like a lighting fade.
- Mood: the calm of blackout before the show starts

### Onboarding
Theatrical: black screen > "What's your house called?" > persona selection > first Room > Spotlight appears empty with invitation to start. Each new scene unlocks with a micro-reveal (0.5s animation, one explanatory phrase, gone forever).

### Mobile
Spotlight is home. Swipe horizontal between scenes. Black background is amazing on OLED. "On tour" mode: simplifies to next show + directions + venue contact + rider.

---

## Proposal 6: "The Rhythm" — CREATIVE
*The app as instrument — you play your work, not manage data*

### Navigation
**Single full-width panel that changes mode.** No sidebar, no split-screen.
- Modes via keyboard (1-5) or minimal top tab-bar:
  - `1` **Pulse** — now: today, this week, needs attention
  - `2` **Reach** — difusion/engagements
  - `3` **Grid** — calendar/planning
  - `4` **Flow** — production and tasks
  - `5` **Settle** — invoicing and money
- Max 2 navigation levels: mode > detail (right drawer). Never a new page.

### Information architecture
Flat, not hierarchical. Entities relate laterally, not nested.
- An engagement has: person, venue, associated Room, communication history, linked shows, linked invoices. But doesn't "belong to" Room — it's linked.
- Rooms function as tags/filters, not folders. A show can have multiple Rooms (co-production).
- Pulse calculates dynamically what to show by crossing data from all modes.

### Primary interaction
Work rhythm by cycles. The app detects (or you choose) what work phase you're in:
- "Outreach mode": prioritizes new contacts, follow-ups
- "Production mode": tasks, deadlines, checklists
- "Closing mode": invoicing, collections, summaries
- "Road mode": calendar, logistics, maps

Each mode reorganizes information — not filters, but **lenses**. Same data seen differently.

- Inline-edit everywhere. No modal forms.
- Swipe on elements for quick actions
- **Stack visual**: elements stack by temporal proximity. Today = top and large, next week = below and smaller, next month = one line. Like papers on a desk — urgent on top.
- **"Groove" notifications**: instead of red badges, elements needing attention have a subtle visual pulse (breathing animation on border). Doesn't scream — breathes.

### Visual identity
- Background: warm off-white (`#f5f2ed`) — like kraft paper or flight case cardboard
- Subtle micro-noise texture. Not flat-dead, not skeuomorphic — a warm middle ground
- Each mode tints the screen subtly (ambient, not chromatic — like studio mood lighting)
- **Typography: serif for titles and names** (Instrument Serif, Fraunces, Lora) + **monospace for data**. Old-meets-new contrast. The serif says "this is culture, not tech."
- Icons: thin line, no fill. Few — text beats ambiguous icons.
- Animations: organic. Elements enter with differentiated ease — in cascade, like musicians entering the stage. Breathing notifications have irregular timing (like real breathing, not mechanical loop).
- Mood: analog recording studio. Warm, tactile, with character.

### Onboarding
"Sound check":
1. "Welcome to soundcheck." — House name
2. "What instrument do you play?" — persona selection with tonal metaphors
3. "First song." — create Room
4. "Where do we start?" — choose starting mode
5. Inline guide disappears after completing the action. No forced tour.

### Mobile
Modes via horizontal swipe. Pulse is mobile home. Stack visual works natively (vertical scroll). Breathing notifications visible at small size. Native widget (iOS/Android): shows Pulse — next show, today's follow-ups, pending invoice.

---

## Agent recommendation

Hybrid: **Desk skeleton + Rhythm soul**
- Base structure: dual-mode sidebar + main panel (Desk) — familiar in 5 seconds
- Inside the panel: modes/lenses logic (Rhythm) instead of fixed tabs
- Visual: warm background with serif for titles (Rhythm), not corporate grey
- Spotlight as home/dashboard concept (from Stage)
- Map as alternative view within Grid/Road mode, not as full architecture
- Kanban as a view option within Reach mode, not the whole architecture

Result: an app that feels familiar in 5 seconds but distinct from everything else in 30.
