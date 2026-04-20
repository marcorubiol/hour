# UX Pattern Analysis — Performing Arts / Booking Management Tools

> Last updated: 2026-04-20
> Method: web research — marketing sites, help docs, changelogs, G2/Capterra reviews, app store listings
> Limitation: no hands-on access to any tool. All findings from public sources.

---

## Summary — What's standard in this space

| Pattern | Standard | Who does it well | Who fails |
|---------|----------|-----------------|-----------|
| Navigation | Left collapsible sidebar | SystemOne, ABOSS, Propared, Overture | StageSwift (top nav only) |
| Primary view | Calendar (monthly default) | All tools | — |
| Secondary view | Table/list for data work | Propared (5 views), ABOSS | — |
| Status on calendar | Color-coded by status | ABOSS (blue/orange/green/red) | SystemOne (single color — top complaint) |
| Detail view | Side panel or in-page edit | SystemOne (rolling out in-page) | Pop-ups (SystemOne legacy) |
| Dark mode | Default, not optional | SystemOne, Overture, ABOSS, Master Tour | — |
| Mobile | Native app, consumption-focused | Master Tour, Overture (offline) | — |
| Cmd+K / global search | **Nobody has it** | — | All (gap) |
| Kanban for bookings | **Nobody uses it** | — | — |

---

## Per-tool analysis

### Stagent (Netherlands)
- Built on Laravel Livewire (real-time updates without page reloads)
- Typography: Inter. CSS vars suggest dark mode support
- eSignature built-in (own software, not third-party)
- Flight tracking by flight number + date — smart micro-feature
- Free plan for every artist invited by their agency
- **Criticism**: "great basic solution for early stage agencies", limited customization, plain text press kits, no Gmail import for contacts

### SystemOne (Berlin) — 34 Capterra reviews, 4.7/5
- Left sidebar (recent redesign from top nav), collapsible
- Color: black primary (#0A0A0A), accents in yellow/green/purple/blue/pink
- Dark (Eclipse) + Light (Lumen) themes
- In-page editing rolling out progressively (Jan-Mar 2026)
- Right-click context menu (Mar 2026) — power user feature
- Activity panels (audit trail)
- **Top complaint: all shows same color on calendar regardless of status** — must open each to check
- Other complaints: pop-up windows for data entry, dashboard "of no use", no global search, duplicate flight entry

### ABOSS (Amsterdam) — 0 reviews on G2/Capterra
- Left sidebar, icon-based. "New booking" button persistent everywhere
- Dark by default with night toggle
- Calendar color coding: blue=interest, orange=option, green=confirmed, burgundy=travel, red=blocked
- 4-tab booking wizard (Booking > Client > Deal > Event). Conflict detection inline
- Deal calculator with break-even
- **Criticism**: basic calendar filtering, no contact tagging/dedup, tasks can't link to records, no merge fields in emails, no unique invoice numbering

### Overture (Brighton) — 15 years, 55k agents/artists
- Sidebar-based (added in redesign). Midnight + Dusk modes
- Curated color palette replaced full-spectrum picker (fixed calendar contrast)
- Multi-tab detail views. e-signatures via Dropbox Sign
- "Replaced five separate software packages" — strong testimonial
- Radius clause management for exclusivity
- **No public pricing, no independent reviews**

### Propared (US) — 6 G2 reviews, 4.5/5
- Left sidebar, collapsible. Open Sans + Montserrat
- 5 calendar views: year/month/week/day/list
- **Production Books**: auto-generated shareable web pages, no login required. Killer feature.
- In-place editing, drag-and-drop scheduling
- QR code scanning for inventory
- Support team are actual production managers
- **Now part of Momentus/Ungerboeck — direction uncertain**

### StageSwift (UK) — zero traction signals
- Top nav only. No public screenshots
- Performing-arts-specific event types (rehearsals, travel, accommodation)
- "On the Road": personal itinerary per team member
- Task view filtered across entire project — batch work pattern
- Accessibility tracking (signed, captioned, relaxed performances)
- **Blockchain signatures — tech-driven, not user-driven**

### Master Tour (US) — 175k+ users
- Desktop app (not web-native). Dark mobile ("all black")
- Typography: Teko headers, Hind Siliguri body
- $65/mo for 1 TM license + unlimited free crew access
- 15,000+ venue database
- **Complaints: destructive redesign broke mental models, free users can't edit on mobile**

---

## What Hour should learn from

1. **ABOSS calendar color coding** — status visible at a glance on calendar. Non-negotiable.
2. **ABOSS persistent "New" button** — context-sensitive creation available everywhere.
3. **Propared Production Books** — shareable web pages, no login. Maps directly to Hour's D6 (guest links).
4. **SystemOne in-page editing** — edit without leaving context. Reduces modal fatigue.
5. **Overture curated color palette** — opinionated defaults > infinite choice.
6. **StageSwift task view across project** — batch work by task type, not by event.
7. **Master Tour pricing** — one license + unlimited free crew access.
8. **SystemOne right-click context menu** — power user escape hatch.
9. **Propared 5 calendar views** — year view is underrated for season planning.
10. **Cmd+K** — nobody has it. Genuine differentiator for power users.

## What Hour should avoid

1. **Single-color calendar** (SystemOne) — most cited complaint.
2. **Pop-up windows** for data entry — use side panels or in-page editing.
3. **Weak contact management** (ABOSS) — no tagging, no dedup.
4. **Desktop-first architecture** (Master Tour) — web-native from day one.
5. **Unlinked tasks** (ABOSS) — tasks must be polymorphic, attachable to any entity.
6. **Outsourced customization** (Stagent via Zapier) — build in, don't outsource.
7. **Destructive redesigns** (Master Tour) — progressive enhancement over replacement.
8. **Buzzword features** (StageSwift blockchain) — technology serves users, not resumes.
9. **Opaque pricing** (Overture) — transparent pricing is a competitive advantage.
10. **Kanban for bookings** — no one in the sector uses it. Calendar + table is validated.

---

## 10 UX recommendations for Hour

1. **Validate ADR-009**: left sidebar + lenses aligns with industry. Cmd+K is unique — nobody has it.
2. **Calendar status colors from day one**: contacted (neutral), in_conversation (warm), hold (amber), confirmed (green), declined (muted), dormant (gray).
3. **Engagement list = sortable table with inline editing**, not cards or kanban.
4. **Detail view = right side panel**, keeps list visible. Not modal, not full page.
5. **Dark mode first** — industry expectation, not preference. Warm dark gray (#1a1a1e).
6. **Persistent context-sensitive "New" action** — creates the right entity based on active lens.
7. **Shareable views without login** (D6) — Propared's Production Books are the benchmark.
8. **Activity trail in UI** — "Last modified by X, 2h ago" on every entity. Audit log already in schema.
9. **Avoid kanban for bookings** — calendar + table is the validated pattern.
10. **Mobile = consumption + quick actions** — checking schedules, changing status, logging calls. Not creation.

---

## Research limitations

- No tool provides public screenshots of actual app interface
- Stagent, StageSwift, Overture have minimal independent reviews
- ABOSS criticisms come from SystemOne-authored comparison (biased source)
- Master Tour support docs returned 403
- Video demos exist but could not be viewed in this research format
- Hands-on trials (Stagent free plan, SystemOne demo, StageSwift trial) would provide ground truth
