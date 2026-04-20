# Tech Rider & Production Documentation Standards

> Last updated: 2026-04-20
> Source: Marco's direct experience as lighting technician + review of his actual project files (Komunumo, MaMeMi)
> Status: initial capture — needs expansion with input from other disciplines (music, dance, circus)

---

## 1. Document types in performing arts production

### Two categories of technical documents

**A. Documents sent TO venues/programmers** (outward-facing)
- **Rider / Ficha técnica** — the master technical document. Contains everything: space requirements, electrical, crew needs, lighting plan (embedded), sometimes input list. Sent as PDF. May exist in multiple languages (CA, ES, EN, FR).
- **Lighting plan / Plànol de llums** — dedicated drawing showing light positions, circuit numbers, fixture types. Sent as PDF. Source file in AutoCAD format (.dwg) or compatible (.lxxplot for LibreCAD/QCad).
- **Stage plot** — top-down view of stage layout (set, performers, tech positions). Often embedded in rider, sometimes separate.
- **Input list / Patch de sonido** — channel-by-channel sound setup. More common in music. Can be inside rider or separate document. Needs further research for music-specific workflows.

**B. Documents received FROM venues** (inward-facing, per gig)
- **Venue technical spec / Fitxa tècnica del venue** — the venue's own tech sheet (stage dimensions, available equipment, rigging points, electrical capacity)
- **Venue bar plot / Plànol de barres** — the venue's lighting bar layout (what's already installed)
- **ContraRider** — venue's response to the company's rider, noting what they can/cannot provide
- **Contracts and festival documentation**

### Key insight: per-gig file storage is essential
Each gig needs a folder where BOTH sent and received documents live together. Marco's current structure (`bolos/YYYY-MM-DD_venue_name/`) already does this organically with files. Hour needs to replicate this digitally.

---

## 2. Formats

### Rider / Ficha técnica
- **Sent as**: PDF (universal)
- **Edited in**: Apple Pages (Marco), also common: Word, Google Docs, InDesign
- **Multi-language**: common to maintain CA/ES/EN versions, sometimes FR
- **No industry standard format** — each company designs their own. Ranges from 2-page simple (Marco) to 20+ page complex (large productions)
- **Common fields** (to validate and expand):
  - Show title, company, duration
  - Minimum stage dimensions (width x depth x height)
  - Electrical requirements (power, connections)
  - Local crew needed (number, roles: lighting, sound, stage)
  - Load-in/load-out time requirements
  - Blackout requirements
  - Audience configuration (frontal, 3/4, round, etc.)
  - Sound requirements (PA, monitors, mics)
  - Special requirements (haze, water, fire, aerial points, etc.)
  - Lighting plan (embedded or referenced)
  - Contact information (production manager, technicians)

### Lighting plan
- **Standard format**: AutoCAD (.dwg) — the format venues expect
- **Actual tools used**: AutoCAD, Vectorworks (industry standard for entertainment), LibreCAD/QCad (.lxxplot — Marco uses this, simpler)
- **Also exported as**: PDF (for inclusion in rider and easy viewing)
- **Venue adaptations**: the lighting plan is the document most commonly adapted per venue. Each venue has different bar positions, circuit availability, and rigging points.

### Stage plot
- **Format**: typically embedded in rider as an image/diagram
- **Tools**: Vectorworks (standard), AutoCAD, sometimes Canva/PowerPoint for simple setups
- **Format expected by venues**: PDF or image. AutoCAD source is a bonus.

---

## 3. Versioning patterns (observed from Marco's workflow)

### Room-level (canonical)
```
Condicions Tècniques/
  PDF/Komunumo_CA.pdf         ← canonical rider, Catalan
  PDF/Komunumo_ES.pdf         ← canonical rider, Spanish
  PDF/Komunumo_EN.pdf         ← canonical rider, English
  Planol/Komunumo.pdf         ← canonical lighting plan
  Planol/Komunumo.lxxplot     ← canonical lighting plan source
  Pages/Komunumo_CA.pages     ← editable source, Catalan
  Pages/Komunumo_ES.pages     ← editable source, Spanish
  Pages/Komunumo_EN.pages     ← editable source, English
```

### Gig-level (adapted per venue)
```
bolos/2026-04-18_mostra_igualada/
  Komunumo La Mostra.pdf          ← lighting plan adapted for THIS venue
  Komunumo La Mostra.lxxplot      ← source of adapted plan
  Barres Teatre Municipal Ateneu.pdf  ← RECEIVED: venue bar layout
  FITXA_TÈCNICA_TM últim.docx       ← RECEIVED: venue tech spec
  notes.md                            ← gig notes
```

### Versioning need identified
Marco flags: "sometimes you're looking at a plan with a person, and later that plan changed — you need to track which version was sent to whom." This is a real tracking problem:
- Which version of the rider/plan was sent to which venue?
- When was it sent?
- Did the venue respond with a ContraRider?
- Was the plan adapted after receiving the venue's bar plot?

---

## 4. How this maps to Hour

### Assets model (already in ADR-009)
Hour already decided: assets live in Room detail view, with Room-level (canonical) and Gig-level (per-venue adaptations).

### What Hour should handle
1. **Room-level assets**: canonical rider (multi-language PDFs), canonical lighting plan (PDF + source), canonical stage plot, input list
2. **Gig-level assets**: adapted lighting plan, adapted rider, received venue docs (tech spec, bar plot, ContraRider)
3. **Version tracking**: which version was sent to whom, when. Append-only versioning with "last sent to [person] on [date]" metadata
4. **File types to support**: PDF (view/download), .dwg/.lxxplot (download only — source files), .pages/.docx (download only — source files), images

### What Hour should NOT try to do
- Edit lighting plans in-browser (AutoCAD/Vectorworks are specialized tools)
- Generate riders from templates (each company's rider is unique — let them upload their PDF)
- Convert between CAD formats

### What Hour COULD do (AI-enhanced, future)
- Extract structured data from uploaded rider PDFs (dimensions, crew needs, electrical) using AI vision
- Compare a venue's tech spec against the show's rider and flag mismatches ("venue has 12kW, show needs 20kW")
- Auto-suggest which assets to send when a new gig is created

---

## 5. Open questions — need more input

- [ ] Music input lists: format, who sends them, how detailed? (Marco hasn't done music recently)
- [ ] Dance-specific requirements: linoleum, sprung floor, wing space? Any specific documents beyond rider?
- [ ] Circus-specific: rigging points, load capacity, ceiling height — separate document or part of rider?
- [ ] How do larger companies (15+ people) manage versions? Is it more structured or equally ad-hoc?
- [ ] Is there any movement toward digital/interactive riders vs static PDFs?
