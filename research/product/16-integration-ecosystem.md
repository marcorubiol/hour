> Hour -- product research
> Tool ecosystem and integration priorities for European performing arts companies
> Status: draft v1 -- 2026-04-20

# 16 -- Integration ecosystem

This document maps the tools that performing arts companies and touring professionals in Europe actually use day to day, and derives integration priorities for Hour. It draws on the user profiles (01-08), web research on specific tools, and cross-referencing with the patterns document (99).

The guiding principle from the existing research: **Hour is the binder between craft tools (left) and admin tools (right). It does not replace any of them.** Integration means: sync the data that matters (dates, contacts, invoices, documents), let the user keep working in their existing tools, and never try to become those tools.

---

## 1. Accounting / finance tools

### 1.1 Spain

The Spanish performing arts sector splits into two financial worlds:

**The company (SL/SLU/cooperative):**
- **Gestoría handles accounting.** The company sends invoices and receipts; the gestoría does the rest. The gestoría's tool (A3, Sage, ContaPlus/ContaSol) is not the company's concern.
- **Holded** is the fastest-growing tool among Spanish pymes. 80,000+ companies. Good UX, all-in-one (invoicing, accounting, CRM, projects). REST API with OAuth2, webhooks, full invoicing endpoints. This is the primary integration target for Spain.
- **FacturaDirecta** is popular among autónomos and micro-companies. Simpler than Holded. REST API with OAuth2, JSON responses, invoicing/contacts/taxes endpoints. Secondary target.
- **Billin** is invoicing-only, very simple, cheap (from 8 EUR/month). No meaningful API. Not an integration target.
- **Quaderno** is for international e-commerce (14,000+ tax jurisdictions). Not relevant for performing arts.
- **SumUp Invoices** (formerly Debitoor) is free, ultra-simple. Has an API but minimal. Not a priority.
- **Quipu** is growing among freelancers. Has API. Tertiary target.

**The autónomo (freelancer, self-managed artist, technician):**
- Most use Holded, FacturaDirecta, or SumUp for invoicing.
- Many still invoice via Word/Excel and hand PDFs to the gestoría.
- The gestoría uses A3 or Sage internally. A3 is the institutional standard for large gestorías (5,000 EUR initial + 500 EUR/month). Hour will never integrate with A3 directly -- that's the gestoría's tool.

**What Hour should do:**
- Export invoice-ready data (CSV/PDF) that the autónomo can hand to the gestoría. This is Phase 0.
- Integrate with Holded API for two-way invoice sync (create invoice in Hour -> push to Holded, or track payment status from Holded). This is Phase 1.
- FacturaDirecta API integration as Phase 2.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| Holded | Common (pymes, growing fast) | Phase 1 must-have | REST API, OAuth2 |
| FacturaDirecta | Common (autónomos) | Phase 2 nice-to-have | REST API, OAuth2 |
| A3 / Sage | Universal (gestorías) | Not needed | Export CSV/PDF for handoff |
| Billin | Niche | Not needed | -- |
| SumUp Invoices | Niche | Not needed | -- |
| Quipu | Growing | Phase 2 nice-to-have | REST API |

### 1.2 France

French performing arts has a unique administrative layer: the **intermittent du spectacle** status. This creates a need for payroll/contract software that is France-specific and not Hour's territory.

**Payroll / labor (NOT Hour's scope):**
- **sPAIEctacle** -- market leader for performing arts payroll (intermittents + permanents).
- **Movinmotion** -- online contracts and payroll for intermittents. Growing.
- **Clapaye** -- payroll, DSN declarations, contracts for intermittents.
- **iPresta** -- career management tool for individual intermittents.

These are sacred tools. Hour will never touch payroll.

**Accounting / invoicing:**
- **Pennylane** -- French unicorn (2024), 120,000+ companies. All-in-one accounting. Modern API. Primary target for France.
- **Indy** -- strong among freelancers (professions libérales, auto-entrepreneurs). Free tier. Good for solo artists.
- **Tiime** -- mobile-first, simple. Free version + 17.99 EUR/month. Secondary.

**Sector-specific:**
- **Orfeo** -- the only real sector-specific SaaS for French performing arts companies. 500+ organizations. Modules: diffusion (contact management, campaigns, scheduling), production (contracts, cachets, per diems), administration (budgets). SaaS, browser-based. Free tier exists, Pro/Enterprise pricing on request. **Orfeo is Hour's closest competitor in France.** Hour must be aware of it but should not try to replicate its payroll/contract features. The opportunity is that Orfeo is France-only and does not serve the cross-border touring reality well.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| Pennylane | Common (growing fast) | Phase 2 | REST API |
| Indy | Common (freelancers) | Phase 2 nice-to-have | TBD |
| Orfeo | Niche (performing arts) | Competitor awareness | -- |
| sPAIEctacle / Movinmotion | Common (payroll) | Not needed (not Hour's scope) | -- |

### 1.3 Germany

- **Lexoffice** -- market leader for small businesses and freelancers. From 7.90 EUR/month. Semi-automated categorization. German-only interface. Has DATEV export.
- **sevDesk** -- strong second. ~25 EUR/month mid-tier. German-only. DATEV export.
- **DATEV** -- the institutional standard. Every Steuerberater (tax advisor) uses DATEV. The relevant integration is DATEV export format, not DATEV API.
- **Norman** -- newer, English interface, AI autopilot. Niche but growing among international freelancers in Germany.

**What matters for Hour:** German companies will need DATEV-compatible export. This is a format, not an API integration.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| Lexoffice | Common | Phase 2 nice-to-have | API + DATEV export |
| sevDesk | Common | Phase 2 nice-to-have | API + DATEV export |
| DATEV export format | Universal | Phase 2 | Export format |

### 1.4 UK

- **Xero** -- dominant among growing SMEs. 800+ integrations. Strong API ecosystem. MTD-compliant.
- **QuickBooks Online** -- strong second. Familiar workflows. Native payroll.
- **FreeAgent** -- popular among sole traders and freelancers. Free via NatWest/RBS banks. 29 GBP/month otherwise.

UK performing arts freelancers overwhelmingly use FreeAgent (free via bank) or Xero. QuickBooks is less common in the arts.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| Xero | Common | Phase 2 | REST API, OAuth2 |
| FreeAgent | Common (freelancers) | Phase 2 nice-to-have | REST API |
| QuickBooks | Common (general) | Phase 2 | REST API |

### 1.5 Netherlands / Belgium

- **Exact Online** -- dominant. 675,000+ clients across NL/BE/DE. All-in-one ERP/accounting/CRM. Has API.
- **Twinfield** -- popular among accountants and accounting firms.
- **Odoo** -- growing, especially in Belgium. Open source. Has API.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| Exact Online | Common | Phase 2 | REST API |
| Twinfield | Niche (accountants) | Not needed | -- |

### 1.6 Accounting integration summary

**Phase 0:** Export invoice-ready CSV/PDF. This covers everyone.
**Phase 1:** Holded API (Spain is the launch market).
**Phase 2:** Xero (UK + international), Pennylane (France), Exact Online (NL/BE). Add DATEV export format for Germany.

The key insight: **Hour should track invoices and payments internally (what is owed, what is paid, aging) but push the actual invoice creation to the accounting tool.** The exception is generating a PDF invoice from Hour data for the autónomo who hands PDFs to their gestoría -- that's a Phase 0 feature.

---

## 2. Calendar / scheduling

### 2.1 What the sector actually uses

From the profiles research, the answer is clear:

- **Google Calendar** is the default for performing arts companies across Europe. It is used for internal scheduling, sharing with crew, and as the "source of truth" calendar.
- **Apple Calendar (iCal)** is used by individuals (especially Mac-heavy creative professionals) but rarely as a shared/organizational calendar. It syncs via CalDAV/iCloud.
- **Outlook Calendar** appears in institutional contexts (venues, municipal theaters, large organizations) but is rare among independent companies.

**No sector-specific scheduling tool exists in wide use.** Companies use Google Calendar with shared calendars per project/tour. The profiles document this universally.

**Propared** offers scheduling features for arts organizations (204 USD/month for production management), but adoption is limited to larger US/UK institutions. Not relevant for mid-size European companies at that price point.

### 2.2 How companies share calendars with crew

- Google Calendar shared calendars (most common)
- Google Sheets with dates/venues (extremely common as a complement)
- WhatsApp messages with screenshots of the calendar or spreadsheet
- PDF tour schedules emailed or shared via Drive

### 2.3 Integration approach

Google Calendar is the only calendar integration that matters for Phase 1.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| Google Calendar | Universal | Phase 1 must-have | Google Calendar API v3, OAuth2 |
| Apple Calendar (iCal) | Common (individuals) | Phase 1 must-have | .ics export/subscribe (CalDAV) |
| Outlook Calendar | Niche (institutional) | Phase 2 nice-to-have | Microsoft Graph API |

**Implementation:** Hour should be the source of truth for show/date data, and push to Google Calendar via API. Users who prefer Apple Calendar get an .ics subscription URL (read-only, auto-updating). This covers 95%+ of users.

The cross-workspace calendar view (profile 07: tour tech seeing all their gigs across companies) is an internal Hour feature, not an integration.

---

## 3. File storage / collaboration

### 3.1 What the sector uses

From the profiles, confirmed by web research:

- **Google Drive** is dominant. Companies store riders, dossiers, contracts, photos, videos in Drive. Shared folders per project or per tour. The entire Google Workspace ecosystem (Docs, Sheets, Slides) is the default collaboration layer.
- **Dropbox** is the secondary option, more common among technicians and older companies. Used for large files (video, audio, QLab sessions) because of better desktop sync for large files.
- **OneDrive** appears only in institutional contexts.
- **WeTransfer** is used for one-off large file transfers (sending riders, press photos to venues).
- **pCloud, Tresorit, Nextcloud** -- negligible in the sector.

### 3.2 How companies share riders, dossiers, contracts

The profiles document this clearly:
- Riders and dossiers are PDFs in a Google Drive folder, shared via link.
- Contracts are Word/PDF, emailed or in Drive.
- Photos/videos for dossiers are in Drive or Dropbox.
- The problem is not where the files are -- it is **which version is current and which was sent to which venue.** This is Hour's value proposition on documents, not file hosting.

### 3.3 Integration approach

Hour should not be a file host. It should:
1. Link to files in Google Drive (and optionally Dropbox) via their APIs.
2. Track which version of a document was shared with which venue/engagement.
3. Allow direct upload to Hour (stored in R2) for users who don't use Drive.
4. Generate shareable links (public guest links, Deferred D6) for external access to specific documents.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| Google Drive | Universal | Phase 1 nice-to-have | Google Drive API, OAuth2 |
| Dropbox | Common | Phase 2 nice-to-have | Dropbox API, OAuth2 |
| OneDrive | Niche | Not needed | -- |

**Phase 0:** Direct upload to R2. No Drive integration needed.
**Phase 1:** Google Drive picker (select file from Drive, link to project/show in Hour). Track version + recipient.
**Phase 2:** Dropbox integration if demand exists.

---

## 4. Communication tools

### 4.1 WhatsApp

**Adoption level: universal in Spain, near-universal in Southern/Western Europe.**

Spain has 33 million WhatsApp users (85% of adult population). In performing arts, WhatsApp is THE real-time coordination layer:
- Band groups per tour/project
- Crew groups per show
- Direct messages to programmers, venue contacts, technicians
- Photo/voice sharing for logistics

**WhatsApp Business** is used by some companies for public-facing communication but is NOT the standard for internal/industry communication. Most performing arts professionals use personal WhatsApp.

**WhatsApp Cloud API** (Meta Business API) allows sending/receiving messages programmatically but requires a verified business, phone number dedication, and has costs per conversation. The profiles research (document 11) already covers this in detail.

**Integration approach:** Hour should NOT try to replace WhatsApp or integrate deeply with it. The maximum useful integration is:
- Log key WhatsApp messages into the engagement timeline (manual: user pastes or forwards).
- Eventually (Phase 2+): WhatsApp Cloud API for sending structured messages (confirmations, day-sheets) from Hour, but this is complex and costly.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| WhatsApp (personal) | Universal | Not an integration target | Manual paste/forward to timeline |
| WhatsApp Cloud API | N/A | Phase 2+ (deferred) | API, verified business, per-message cost |

### 4.2 Telegram

Telegram has grown significantly (1 billion MAU globally as of March 2025) and has meaningful adoption in Spain, particularly:
- Tech communities and younger professionals
- Some performing arts groups (especially in Catalonia and alternative/independent scenes)
- Growing for business channels

However, in performing arts companies specifically, WhatsApp remains dominant. Telegram is a secondary channel. The Bot API is well-documented and free.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| Telegram | Growing, secondary | Phase 2 nice-to-have | Bot API (free, well-documented) |

### 4.3 Email

- **Gmail** is the default across all profiles. Many companies use Google Workspace with custom domains (company@companyname.com via Google Workspace).
- **Outlook/Microsoft 365** appears in institutional/municipal contexts.
- Some older companies still use hosting-provided email (IMAP/SMTP).

**Email integration** is the most-requested and most-complex integration across the profiles. The research (document 99, section 6.3) correctly places it in Phase 2. The integration is:
- Thread emails into engagement/show records in Hour.
- NOT become an email client. Gmail stays open.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| Gmail | Universal | Phase 2 (complex) | Gmail API, OAuth2 |
| Outlook | Niche | Phase 2+ | Microsoft Graph API |
| Generic IMAP | Niche | Not needed | -- |

### 4.4 Signal / Slack / other

- **Signal** -- negligible in performing arts. Some privacy-conscious individuals.
- **Slack** -- almost nonexistent in European performing arts companies. US/UK tech-adjacent companies only.
- **Discord** -- negligible. Some music communities.

None of these are integration targets.

---

## 5. Technical production tools

### 5.1 Show control

**QLab** (Figure 53, Mac-only):
- The de facto standard for sound and multimedia playback in theater across Europe and globally.
- Used in 100+ countries, from community theater to Broadway/West End.
- Handles sound, video, lighting (via network), and projections.
- Used by profiles 01 (theater companies), 07 (tour technicians), and partially 02 (bands with backing tracks).
- License model: free basic, then per-feature licenses ($450-700 for full).
- **No API. Proprietary session files (.qlab4, .qlab5).**
- Hour should host QLab session files as Room-level assets, not try to read or edit them.

**Ableton Live** (Ableton, Mac/Windows):
- Standard for music production and live performance sound.
- Used by profiles 02 (bands), 05 (solo artists), 07 (technicians in music contexts).
- Ableton Live Set files (.als) are the session format.
- **No relevant API for tour management.**
- Hour should host Ableton session files as assets.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| QLab | Universal (theater) | Not an integration | Host session files as assets |
| Ableton Live | Common (music) | Not an integration | Host session files as assets |

### 5.2 Lighting consoles

**ETC Eos family** (ETC, US-based):
- The standard for theater lighting in permanent venues across Europe and the US.
- Eos Ti, Eos, Ion, Element 2 -- different price points, same software ecosystem.
- Show files are proprietary.

**grandMA3** (MA Lighting, Germany):
- The standard for touring, concerts, festivals, and large-scale events.
- Dominant in music touring and festival lighting.
- grandMA3 software can run on PC (free for offline programming).

**Hog 4** (High End Systems / ETC):
- Third position. More common in the US than Europe.

**For Hour:** These are craft tools. Hour does not integrate with them. Hour hosts the show files and lighting plots as assets attached to shows/rooms.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| ETC Eos | Universal (theater venues) | Not an integration | Host show files as assets |
| grandMA3 | Universal (touring/concerts) | Not an integration | Host show files as assets |
| Hog 4 | Niche | Not an integration | Host show files as assets |

### 5.3 Stage design / technical drawing

**Vectorworks Spotlight:**
- Industry standard for stage, lighting, and event design.
- Used for stage plots, lighting plots, rigging plans.
- Expensive (~2,000+ EUR/year). Used by professional designers and larger companies.
- Files: .vwx format.

**AutoCAD:**
- Used in some venues and by some older designers.
- Being displaced by Vectorworks in entertainment.

**SketchUp:**
- Used for quick 3D visualization, especially by set designers.
- Free version available. Lower barrier.

**Capture / wysiwyg:**
- Pre-visualization tools for lighting design. Niche but important for LDs.

**For Hour:** None of these are integration targets. Hour hosts the files (Vectorworks stage plots, AutoCAD drawings) as Room-level or Show-level assets. The key innovation for Hour is not editing these files but **tracking which version of the stage plot was sent to which venue** and whether it matches the rider.

### 5.4 Rider / stage plot creation tools

A small ecosystem of web tools exists for creating riders and stage plots:

- **StagePlotPro / Stage Plot Designer** -- simple drag-and-drop stage plot creators.
- **LSV StagePlot** -- Spanish tool, drag-and-drop, free, exports to PDF.
- **RiderForge** -- newer, creates stage plots and channel lists.
- **Ridermaker** -- similar, web-based.
- **SaveYourBand** -- AI-assisted rider creation.

These are mostly used by self-managed bands and small acts (profiles 04, 05). Professional companies create riders in Word/InDesign/Vectorworks.

**For Hour:** The opportunity is not to integrate with these tools but to **build a lightweight rider template system within Hour** that generates professional PDFs. This is an Hour feature, not an integration. But it is Phase 2 at earliest -- there are bigger wins first.

---

## 6. CRM / contact management

### 6.1 What companies actually use today

The profiles are emphatic: **there is no standard CRM in European performing arts.** The reality:

- **Google Sheets / Excel** -- the universal default. Every company has a spreadsheet of programmers, venues, festivals. This is the single most common "CRM" in the sector.
- **Airtable** -- the "promised land" (patterns document 99, section 1.3). Used by the more organized companies and distributors. Fails every 18-36 months when maintenance overhead exceeds capacity during peak season. Airtable has a strong REST API.
- **Notion** -- used by younger companies and solo artists for mixed notes + databases. Less structured than Airtable. Has API.
- **Gmail contacts** -- a de facto CRM for many. The inbox IS the CRM.
- **FileMaker** -- legacy, found in some older French and Spanish companies. Being replaced.

**Sector-specific CRM/booking tools (existing competitors):**

| Tool | Focus | Market | Pricing | API |
|------|-------|--------|---------|-----|
| Orfeo | Performing arts (FR) | France, 500+ orgs | Freemium, Pro on request | Unknown |
| Gigwell | Booking agencies | US/UK, expanding | $49/month (artist), Enterprise $799/month | Yes (Pro+) |
| Stagent | Booking/management | EU (Netherlands-based) | EUR 39-99-799/month | Zapier |
| Muzeek | Live music venues/booking | EU/US | Free Lite, $9-99/month/user | Limited |
| StageSwift | Tour/event management | UK/EU | Pay-as-you-go | Unknown |
| Propared | Production planning | US/UK | $204-299/month | Limited |
| Master Tour (Eventric) | Tour management | US/UK (major tours) | Enterprise pricing | Limited |

**Key observation:** The venue-side CRMs (Spektrix, VenueArc, BravoBase, UpStage) are for venues selling tickets to audiences. They are NOT competitors to Hour. Hour serves the company/artist side, not the venue/presenter side.

### 6.2 Integration approach

The main integration need is **import**, not live sync:

- Import from Google Sheets / Excel (CSV). This is Phase 0 -- already partially built (the MaMeMi 154-contact import).
- Import from Airtable (REST API). This catches the user mid-rebuild-cycle (patterns 99, recommendation 10).
- Import from Notion (API). Lower priority.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| Google Sheets / Excel | Universal | Phase 0 (done) | CSV import |
| Airtable | Common (power users) | Phase 1 nice-to-have | REST API import |
| Notion | Growing | Phase 2 nice-to-have | API import |
| Gmail contacts | Common | Phase 2 | Google Contacts API |

---

## 7. Dossier / press kit creation

### 7.1 What companies use

- **Adobe InDesign** -- the professional standard for dossier layout. Used by companies that have a designer (internal or freelance). Produces PDFs.
- **Canva** -- the accessible alternative. Growing fast among small companies and self-managed artists. Free tier sufficient for basic dossiers. Templates available.
- **Google Slides / Docs** -- used for quick dossiers, especially by distributors who need to assemble per-venue packages fast.
- **PowerPoint** -- legacy, declining.
- **Word + PDF export** -- still common for text-heavy dossiers.

**The dossier is always a PDF at the end.** Regardless of the creation tool, what gets sent to the programmer is a PDF.

### 7.2 Integration approach

Hour should NOT be a dossier editor. The integration is:
- Host the PDF as a Room-level asset.
- Track versions (which dossier was sent to which engagement).
- Generate a public shareable link for the latest version.
- Optionally: allow building a simple "micro-dossier" from structured data (show title, description, photos, video links, tech specs) that renders as a branded PDF or web page. This is a Phase 2 feature.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| InDesign | Common (pro) | Not an integration | Host output PDFs |
| Canva | Common (accessible) | Not an integration | Host output PDFs |
| Google Slides | Common | Not an integration | Host output PDFs |

---

## 8. Travel / logistics

### 8.1 How companies book travel

From the profiles research:
- **No centralized booking tool.** Each person books their own travel in most small/medium companies.
- For tours: the production manager or tour manager books centrally, often via Booking.com, Airbnb, Renfe/SNCF/Deutsche Bahn websites, and low-cost airline sites (Ryanair, Vueling, easyJet).
- Some larger companies use travel agencies.
- **Master Tour** (Eventric) handles travel logistics for major tours but is enterprise-priced and US-centric.
- **StageSwift** offers lightweight tour logistics but is early-stage.

### 8.2 Per diem management

- Managed in spreadsheets (Google Sheets / Excel). Almost universally.
- Some companies use Holded or FacturaDirecta to track expenses.
- Per diem amounts are usually fixed per country (the company sets a rate).

### 8.3 Route planning

- **Google Maps** for route planning. Universal.
- No sector-specific route planning tool in meaningful adoption.

### 8.4 Integration approach

Travel and logistics is NOT a Phase 0 or Phase 1 integration target. The need is real but the tools are fragmented (each person using different booking platforms). The Hour feature is:
- Store travel details per show/date (hotel, flights, car) as structured fields.
- Calculate per diems based on show dates and locations.
- This is an internal Hour feature, not an integration.

| Tool | Adoption | Integration priority | Approach |
|------|----------|---------------------|----------|
| Google Maps | Universal | Phase 1 (embed) | Maps Embed API (free) |
| Booking.com / airlines | Universal (fragmented) | Not an integration | Store details as structured fields |
| Master Tour | Niche (enterprise) | Not a target | -- |

---

## 9. Integration priority matrix

Consolidating all categories into a single priority view:

### Tier 1: Must-have (Phase 0-1)

| Integration | Why | Approach | Effort |
|-------------|-----|----------|--------|
| CSV/PDF export (invoices) | Covers all users from day 1 | Generate from Hour data | Low |
| CSV import (contacts) | Onboarding from Sheets/Excel | Already partially built | Low |
| Google Calendar sync | Universal adoption, show dates are the core data | Google Calendar API v3 | Medium |
| .ics subscription feed | Apple Calendar + any CalDAV client | Generate .ics from show data | Low |
| Google Maps embed | Venue location on show/date records | Maps Embed API | Low |
| File upload to R2 | Riders, dossiers, show files | Already in architecture | Low |

### Tier 2: High-value (Phase 1)

| Integration | Why | Approach | Effort |
|-------------|-----|----------|--------|
| Holded API | Spanish market invoicing | REST API, OAuth2 | Medium |
| Google Drive picker | Link files from Drive to projects/shows | Drive API, OAuth2 | Medium |
| Airtable import | Catch users mid-rebuild | REST API one-time import | Medium |

### Tier 3: Growth (Phase 2)

| Integration | Why | Approach | Effort |
|-------------|-----|----------|--------|
| Gmail threading | Most-requested; complex | Gmail API, OAuth2 | High |
| Xero API | UK market | REST API, OAuth2 | Medium |
| Pennylane API | French market | REST API | Medium |
| Exact Online API | NL/BE market | REST API | Medium |
| DATEV export | German market | Export format | Low |
| Dropbox API | Secondary file storage | Dropbox API, OAuth2 | Medium |
| Outlook Calendar | Institutional users | Microsoft Graph API | Medium |
| Notion import | Growing user base | API one-time import | Low |
| Telegram Bot | Notifications, quick actions | Bot API (free) | Medium |

### Not needed (confirmed by research)

| Tool | Why not |
|------|---------|
| QLab, Ableton, Eos, grandMA3 | Craft tools. Host files, don't integrate. |
| sPAIEctacle, Movinmotion, Clapaye | Payroll is not Hour's scope. |
| A3, Sage, ContaSol | Gestoría tools. Export CSV/PDF is sufficient. |
| Slack, Discord, Signal | Negligible adoption in the sector. |
| Vectorworks, AutoCAD, SketchUp | Host output files, don't integrate. |
| InDesign, Canva | Host output PDFs, don't integrate. |
| Spektrix, VenueArc, BravoBase | Venue-side tools, not company-side. |
| Booking.com, airlines | Fragmented; store details as fields instead. |

---

## 10. Prioritized integration roadmap

### Phase 0 -- internal use (MaMeMi, now)

**Build 3 things:**
1. **CSV import** for contacts (done).
2. **CSV/PDF export** for invoice-ready data (structured show data -> PDF or CSV that can be handed to gestoría).
3. **File upload** to R2 for riders/dossiers/show files (already in architecture).

**Zero external API dependencies.** Everything works offline-first.

### Phase 1 -- first paying customers (month 6-12)

**Build 4 integrations:**
1. **Google Calendar two-way sync** -- push show dates from Hour to Google Calendar; read availability back. This is the single highest-value integration because it eliminates the "calendar + spreadsheet + WhatsApp" reconstruction problem documented in every profile.
2. **.ics subscription feed** -- one URL per user/project/workspace that any CalDAV client (Apple Calendar, Thunderbird, Outlook) can subscribe to. Low effort, high coverage.
3. **Holded API** -- create/push invoices from Hour to Holded. Track payment status. This covers the Spanish launch market.
4. **Google Drive file picker** -- select files from Drive, link them to projects/shows in Hour. Track "which version was sent where."

**Optional Phase 1:**
5. **Airtable one-time import** -- catch users migrating from Airtable. This is onboarding, not ongoing sync.

### Phase 2 -- growth (month 12-24)

**Expand by market:**
- **UK:** Xero API
- **France:** Pennylane API
- **Germany:** DATEV export format
- **NL/BE:** Exact Online API

**Expand by depth:**
- **Gmail integration** -- thread emails into engagement records. This is the most complex integration and the most requested. Build it when the core product is solid.
- **Dropbox API** -- for users who store files there instead of Drive.
- **Telegram Bot** -- lightweight notifications and quick actions (confirm/decline from Telegram).
- **Notion/Google Contacts import** -- lower priority but easy wins.

### What NOT to build (ever, based on research)

- WhatsApp native integration (too complex, too expensive, too invasive)
- Payroll/labor compliance features
- Craft tool editors (rider editor, stage plot editor, cue editor)
- CRM for the venue side (ticket sales, audience management)
- Social/discovery features (roster pages, gig matching)
- Payment processing (moving money)

---

## 11. Competitive positioning through integrations

The integration strategy reinforces Hour's position:

**Orfeo** (closest competitor, France): does diffusion + production + administration but is France-only, no cross-border, no multi-tenant freelance model. Hour wins by being cross-border and multi-workspace.

**Gigwell / Stagent** (music booking): US/UK-centric, music-only, booking-agency-oriented. Hour wins by serving theater/dance/circus AND music, company AND freelance.

**Propared** (production planning): US-priced ($204+/month), venue/institution-oriented. Hour wins on price and on serving touring companies, not venues.

**Master Tour** (tour logistics): enterprise, major tours. Not competing for the same market.

**Airtable/Notion** (generic): the 18-month rebuild cycle is Hour's acquisition channel. Import from Airtable is not a competitor response -- it is an onboarding feature.

The 5 integrations that define Hour's competitive advantage:
1. **Google Calendar sync** -- no competitor does this well for multi-workspace touring.
2. **Holded/Xero/Pennylane** -- accounting handoff by market, not a built-in accounting system.
3. **Google Drive file picker** -- version-tracked document linking, not file hosting.
4. **.ics feed** -- universal calendar access without platform lock-in.
5. **CSV/Airtable import** -- catch users at the migration moment.

---

## Sources

Research in this document draws on:
- Hour user profiles 01-08 and patterns document 99 (same repository)
- Hour product research documents 10-14 (same repository)
- [Billin -- mejores programas de facturación 2026](https://www.billin.net/blog/mejores-programas-facturacion/)
- [Quaderno -- programas de facturación](https://quaderno.io/es/articulos/programas-facturacion/)
- [Banktrack -- software facturación España](https://banktrack.com/blog/software-facturacion-espana)
- [Holded API documentation](https://developers.holded.com/)
- [FacturaDirecta API](https://www.facturadirecta.com/en/developer/)
- [Software contable gestorías comparativa](https://bvnj.com/blog/software-contable-gestorias-comparativa/)
- [Pennylane -- French accounting unicorn](https://techcrunch.com/2024/02/07/accounting-software-startup-pennylane-becomes-frances-latest-unicorn/)
- [Indy -- comparatif comptabilité](https://www.indy.fr/guide/comptabilite-en-ligne/logiciel/comparatif/)
- [Norman Finance -- accounting software Germany](https://norman.finance/blog/best-accounting-software-freelancers-germany)
- [Xero vs QuickBooks vs FreeAgent UK](https://www.e-accounts.co.uk/2025/12/16/xero-vs-quickbooks-vs-freeagent-uk-2026/)
- [Exact (company) -- Wikipedia](https://en.wikipedia.org/wiki/Exact_(company))
- [QLab overview](https://qlab.app/overview/)
- [Vectorworks Spotlight](https://www.vectorworks.net/en-US/spotlight)
- [Gigwell vs Stagent](https://www.gigwell.com/blog/gigwell-vs-stagent)
- [Muzeek features](https://muzeek.com/)
- [Stagent features](https://stagent.com/features)
- [Propared](https://www.propared.com/)
- [StageSwift](https://www.stageswift.com)
- [Master Tour -- Eventric](https://www.eventric.com/master-tour-management-software/)
- [Orfeo -- spectacle vivant](https://orfeo.pro/)
- [Google Calendar API](https://developers.google.com/calendar/api/guides/overview)
- [WhatsApp in Spain](https://indigitall.com/en/blog/whatsapp-in-spain-how-has-its-usage-evolved/)
- [Telegram statistics 2026](https://thunderbit.com/blog/telegram-stats)
- [La Fabrique de la Danse -- outils gestion compagnie](https://www.lafabriquedeladanse.fr/2017/ressources/4-outils-gestion-compagnie/)
- [sPAIEctacle](https://www.ghs.fr/spaiectacle/)
- [Clapaye](https://www.clapaye.fr/)
- [Rider tools -- Instalia](https://instalia.eu/aplicaciones_para_hacer_un_buen_rider_tecnico_por_producciones_el_sotano_9227/)
- [RiderForge](https://www.riderforge.app/)
