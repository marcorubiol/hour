# Hour — Design System Prompt

> Copy and paste this entire prompt into your design tool (Claude, Gemini, etc.) to give it full context for designing Hour's UI.

---

## What is Hour

Hour is a B2B SaaS for live performing arts management. It covers the full funnel: booking outreach (difusion) → production → execution → invoicing. Target: mid-size European performing arts companies (theater, dance, circus, indie music) that tour across countries.

It is NOT a labor compliance tool, NOT a ticketing system, NOT a venue management tool. It is the tool for the company that books, produces, and tours its own work.

## Product vocabulary

These are the terms used in the UI. Never use the technical/database names in the interface.

| UI term | What it is | DB name |
|---------|-----------|---------|
| **House** | Workspace (a company, collective, or individual) | `workspace` |
| **Room** | A project (a show, a tour, a season, a creation) | `project` |
| **Run** | A line/series of dates within a Room | `line` |
| **Gig** | A single show/performance | `show` |
| **Desk** | The primary UI lens — your work dashboard | — |

Anti-CRM vocabulary — NEVER use: lead, pipeline, funnel, conversion, deal, prospect. Instead use: person, engagement, show, venue, date.

## Who uses Hour

8 user profiles, from solo artist to 15-person production company:
1. Small-medium theater/dance/circus company (3-15 people, touring EU)
2. Indie/jazz/experimental band (5-8 people)
3. Small music production company (2-5 people, 5-15 artists)
4. Self-managed band (no manager, no label)
5. Solo independent artist
6. Freelance cultural distribution agent (books for several companies)
7. Tour technician (sound/lights, works with 2-4 companies)
8. Manager/booking agent (represents multiple artists)

Key: these are creative people, not office workers. They're skeptical of "yet another tool." The switching cost from Excel+WhatsApp is emotional, not technical. Trust matters more than features.

## Navigation architecture (FIRM — follow exactly)

### Two-axis model: Lenses × Sidebar

The app has ONE layout with two controls:
- **Lenses** (sidebar, top section): determine WHAT TYPE of content is displayed
- **Sidebar entities** (sidebar, bottom section): Houses and Rooms — determine SCOPE/CONTEXT

### Sidebar layout
```
Desk            ← active lens (highlighted)
Calendar
Contacts
Money
────────────────
● MaMeMi        ← houses, flat list
  Room A    3   ← room with gig count badge
  Room B    2
● Kairos
  Room C    1
● La Veronal
  Room X    5
● Co C [arch]   ← archived, collapsed
────────────────
Marco Rubiol    ← user
⌘K · search     ← command palette
```

### Dual-mode behavior

**Desk lens** treats sidebar selections as DESTINATIONS:
- Nothing selected → Panoramic view: "everything on your plate" across all Houses
- House selected → House detail: rooms, stats, recent activity
- Room selected → Room detail with tabs: Work | Assets | Team | About

**All other lenses** (Calendar, Contacts, Money) treat sidebar selections as FILTERS:
- Nothing selected → shows everything
- House selected → filters to that House's data
- Room selected → filters to that Room's data

Filters persist across lens switches. If Room A is selected and you switch from Desk to Calendar, the calendar shows only Room A's gigs.

### ⌘K Command palette
First-class citizen from day 1. Supports: switching houses/rooms, jumping to any entity, switching lenses, executing actions. Power users can hide the sidebar entirely and use only ⌘K.

### Room detail view (Desk + Room selected)
Tabs within content area:
- **Work** — runs, gigs, tasks for this room
- **Assets** — riders (versioned, multi-language), dossiers, stage/lighting/sound plots, QLab sessions, Ableton sessions, photos, videos, press kit. Each asset tracks: version, upload date, uploader, last sent (to whom, when). Room-level (canonical) + Gig-level (per-venue adaptations).
- **Team** — members and roles for this room
- **About** — description, tags, status

## Visual direction (FIRM decisions)

### Theme
- **Light mode is PRIMARY.** Warm, not sterile white.
- Dark mode available as user preference, not default.
- This differentiates from competitors who all default to dark.

### Personality
The hybrid approach: **Desk skeleton + Rhythm soul**
- Structure: familiar sidebar + main panel (users understand it in 5 seconds)
- Inside the panel: modes/lenses logic gives depth
- **Serif for titles and names** (e.g., Instrument Serif, Fraunces, Lora) — says "this is culture, not tech"
- **Sans-serif or monospace for data** — functional contrast
- Warm background (off-white, not clinical white — think kraft paper, flight case cardboard)
- Subtle micro-noise texture — not flat-dead, not skeuomorphic
- Each lens can have a subtle ambient tint (not chromatic — like mood lighting)

### Density
Medium. Not minimalist-empty, not dashboard-saturated. Like a well-spaced musical score — you see what you need without drowning.

### Icons
Thin line, no fill. Few — text beats ambiguous icons.

### Animations
Organic. Elements enter in cascade (like musicians entering the stage). No bouncing, no flashing. Smooth ease-out, 200-400ms.

### "Groove" notifications
Instead of red badge numbers, elements needing attention have a subtle breathing animation on their border. Doesn't scream — breathes. Irregular timing, like real breathing.

### Color usage
Color communicates STATE, not decoration:
- contacted → neutral
- in_conversation → warm
- hold → amber
- confirmed → green
- declined → muted/struck
- dormant → gray
- urgent → contained red

### Skin-ready architecture
All visual properties must go through design tokens (CSS custom properties): colors, typography, border-radius, spacing, textures, shadows, density. No hardcoded visual values in components. Switching skin = swapping a token file. Launch with one skin (warm default), but the architecture must support future skins (e.g., "Backstage" amber/technical, "Studio" clean/minimal, "Stage" dark/performer).

### Existing design reference
A Desk panoramic view mockup already exists with:
- Serif heading ("Hello, Marco."), warm off-white background
- House color tags on each task item for cross-house identification
- Mixed item types in one list (TASK, MONEY, EVENT, MER)
- Role filter pills (sound, production, lighting, distribution, author, musician)
- "What's alive right now" as a secondary section below the task list
- High density but readable — this is the target density level

### What to avoid
- Corporate grey SaaS look
- Red badge notification numbers
- Pop-up windows for data entry (use side panels or in-page editing)
- Kanban as the main view for bookings (calendar + table is the primary pattern)
- Cluttered dashboards with too many widgets

## Key UX patterns to follow

1. **Calendar with status colors** — the primary view. Status visible at a glance via color coding. Minimum: month + list views. No single-color calendar (biggest complaint about competitors).
2. **Engagement list = sortable table with inline editing** — not cards, not kanban. Click a row → right side panel with full detail (keeps list visible for context).
3. **Persistent context-sensitive "New" action** — available everywhere. Creates the right entity based on active lens (engagement in Contacts, gig in Calendar, etc.).
4. **In-page editing** — edit without leaving context. No modal forms for simple changes.
5. **Activity trail** — "Last modified by X, 2h ago" on every entity.

## Mobile

- Sidebar collapses to drawer
- ⌘K becomes primary navigation
- Supports CREATION of contacts, engagements, status changes, notes (not just viewing)
- Full complex workflows (invoices, asset management) remain desktop
- Creation is streamlined: minimal fields, smart defaults

## AI philosophy

AI is everywhere but invisible — like a stage manager (regidor/a):
- Suggests, never imposes
- Works in background (enrichment, classification, summarization)
- Appears inline where relevant, NOT as a chatbot sidebar
- No "AI" branding — it just works
- Examples: auto-enrich contacts, suggest next actions, extract data from PDFs, detect scheduling conflicts

## Onboarding

- Template-driven: pre-populated sample show ("Ombra Tour 2026") with sector-specific data
- Clearly labeled as demo, one-click removable
- Max 4 steps before the user sees value
- No forced product tour — inline guidance that disappears after use
- "Aha moment": "I created a show with venue, dates, and contacts in 2 minutes and it looks professional"

## What makes Hour different from everything else

1. **Nobody bridges booking outreach AND production management** — every competitor does one or the other
2. **Company perspective, not agency perspective** — the user IS the artist/company, not an intermediary
3. **European and multi-country from day 1** — i18n, multi-currency, cross-border invoicing
4. **Anti-CRM vocabulary** — speaks the language of performing arts, not sales
5. **⌘K command palette** — no competitor has it
6. **The tool should feel like it belongs backstage** — professional, warm, quiet, everything at hand, nothing screams
