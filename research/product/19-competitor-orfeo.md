# Competitor Deep Dive: Orfeo (orfeo.pro)

> **Research date:** 2026-04-20
> **Sources:** orfeo.pro (FR/EN/DE versions), LinkedIn, annuaire-entreprises.data.gouv.fr, orfeoapp.com login page inspection.
> **Confidence:** High on product features and company structure. Medium on financials and internal strategy. Low on actual user satisfaction beyond curated testimonials.

---

## 1. Company & Team

### Legal entity
- **Company name:** ORFEO
- **Legal form:** SAS (Société par Actions Simplifiée)
- **SIREN:** 750 648 602
- **Capital social:** €37,500
- **Creation date:** March 10, 2012
- **NAF code:** 58.29C — Édition de logiciels applicatifs (application software publishing)
- **Registered address:** 11 Place de Bretagne, 35000 Rennes, France
- **Active establishments:** 1 (of 6 total historically)

### Founding
- **Founder:** Thomas Petillon (still CEO/dirigeant as of 2026)
- **Founded:** 2012 legally, though website says "2015" — likely 2012 incorporation with 2015 product launch or pivot to current form.

### Team
- **LinkedIn claims:** 67 employees (likely inflated — LinkedIn counts include past employees and loose affiliations)
- **Government data (2023):** 10-19 employees
- **Website team page lists:** 20 named people, which aligns better with reality (~20-25 current team)

**Key people:**
| Name | Role |
|------|------|
| Thomas Petillon | Founder / CEO |
| Maxime Lorant | Technical Manager (CTO equivalent) |
| Charles Mahé | Commercial & Marketing Manager |
| Marie Taupin | Customer Service Manager |
| Claudie Trégouët | Project Team Manager |
| Laure Dufourg | Administrative & Financial Manager |
| Bérénice Michel | Product Owner |
| Benjamin Vandamme, Maël Delanoë, Florian Pereira | Developers (3 named) |

The dev team appears small — 3 named developers + 1 Product Owner. This suggests either a very lean engineering org or additional unnamed/contractor developers.

### Location
- Rennes, Brittany, France
- Phone: +33 (0)2 30 96 38 21

### Funding
- **No evidence of external funding.** No mentions of VC, no Crunchbase profile found, no press releases about fundraising. The €37,500 capital is modest — this looks like a bootstrapped company. Given the SAS structure and small capital, it's likely founder-funded, possibly with regional grants (Brittany has strong tech ecosystem support via BPI, Rennes Atalante, etc.), but I cannot confirm this.

### Hiring
- Currently hiring a Marketing & Development intern (Indeed posting)
- Spontaneous applications accepted at recrutement@orfeo.pro
- "On recrute" banner on site, but only one active listing visible

---

## 2. Product Features

### Tagline
"Logiciel coeur de métier du spectacle vivant" — Core business software for performing arts.

### Architecture
- **Web-based SaaS** — app hosted at orfeoapp.com
- **Mobile app** exists (mentioned across multiple modules for schedule sharing)
- **Tech stack discovered from login page:**
  - **Backend:** Django (Python)
  - **Frontend:** Bootstrap + jQuery + custom datepicker
  - **CDN:** CloudFront
  - **Monitoring:** New Relic RUM
  - **Analytics:** Matomo Tag Manager
  - **Auth:** OAuth2 (Google login supported)
  - **Current version:** 10.3.9
- **Hosting:** "Private cloud" (they emphasize this — not AWS/GCP/Azure public cloud, apparently their own infrastructure with redundancy)
- **CMS for marketing site:** GravCMS (flat-file PHP CMS)

### Modular structure — 10 modules

#### 1. Planning général (General Planning)
- Multi-view calendar (daily to quarterly)
- Show programming from "option" to "confirmation" stages
- Space/venue occupancy management
- Filterable by venue, project, event type
- Auto-generation of welcome sheets and route documents
- Task assignment and collaborative notes

#### 2. Planning du personnel (Staff Planning)
- Staff scheduling with availability management
- Handles permanent, intermittent (freelance), and contractor staff
- Work time counters and alerts
- Real-time sharing via mobile app
- Export capabilities

#### 3. Vente (Sales / Diffusion / Booking)
- **This is their CRM/diffusion module — directly competes with Hour's core proposition**
- Collaborative contact directory
- Tag-based segmentation and filtering
- Email synchronization into contact records
- Targeted outreach campaigns ("messages personnalisés à une cible qualifiée")
- Opportunity pipeline management (tracking prospects through funnel)
- Automated reminders for follow-ups
- Full booking lifecycle: initial contact → negotiation → confirmation

#### 4. Contrats (Contracts)
- Auto-generation from customizable templates with merge fields
- Contract types: sales (cession), rental (location), equipment provision (mise à disposition), co-production, co-creation
- Pre-contract negotiation tools
- Electronic signature integration
- Amendment management
- Tracking through to signature completion

#### 5. Factures (Invoicing)
- Auto-generation from project/show data
- Invoice + credit note (avoir) support
- Payment tracking and overdue alerts
- Sales journal export
- Configurable accounting/analytical data
- **No mention of third-party accounting software integration** (notable gap)

#### 6. Régie de tournée (Tour Management)
- Production scheduling covering artistic, technical, accommodation, travel
- Template-based schedule creation
- Cast/distribution building from employee database
- Route sheet (feuille de route) generation
- Mobile app notifications for schedule changes
- Availability tracking for permanent + freelance staff

#### 7. Social (HR / Payroll)
- **Deeply France-specific**
- Centralized employee database
- One-click employment contract generation (artists, technicians, soloists)
- Automated DPAE (Déclaration Préalable à l'Embauche) submission — mandatory French pre-hire declaration
- Electronic bulk signature
- **Integration with sPAIEctacle** — French performing arts payroll software
- Handles intermittents du spectacle (France's unique freelance performing arts employment status)

#### 8. Régie d'orchestre et opéra (Orchestra & Opera Management)
- Specialized music library/repertoire reference with detailed nomenclatures
- Artist distribution management (permanent + freelance)
- Handles upgrades, additional positions, absences, replacements
- Compensation detail tracking
- Mobile app for artist schedule notifications

#### 9. Budget
- Customizable expense/revenue categories
- Project-based financial tracking
- Automatic aggregation across projects/periods
- Collaborative input from multiple contributors
- Contract data auto-sync into budgets
- **API integration mentioned** for analysis tools (only module where API is explicitly referenced)

#### 10. Matériel (Equipment)
- Centralized inventory (technical gear, costumes, instruments)
- Detailed records with photos and attached documents
- Equipment reservation linked to projects
- Real-time stock/availability monitoring
- Loan and rental tracking

### What Orfeo does NOT have (gaps identified)
- **No ticketing integration** mentioned
- **No audience/public-facing features** — purely back-office
- **No document storage/file management** beyond equipment photos
- **No built-in email client** — they sync with external email
- **No accounting software integration** explicitly mentioned (beyond export)
- **No multi-currency support** mentioned
- **No multi-country tax/legal compliance** — deeply tied to French system (DPAE, sPAIEctacle, intermittents)
- **No technical rider management** as a standalone feature
- **No festival management** module (though festivals are mentioned as a client type in testimonials)

---

## 3. Target Audience

### Six named segments (in order of prominence on site)

1. **Lieux de spectacle** (Venues) — theaters, concert halls, cultural centers
2. **Tourneurs** (Touring companies / Bookers) — musiques actuelles, jazz, humour
3. **Orchestres & Opéras** — permanent orchestras, opera houses, ballets
4. **Compagnies** (Companies) — dance, theater, circus, street arts
5. **Ensembles** — vocal and instrumental ensembles, choirs
6. **Agents artistiques** (Artistic agents) — soloists, lyric artists, conductors

### Organization sizes
- From their testimonials: ranges from small 2-3 person companies (Compagnie 3637, Toutito Teatro) to large institutions (Orchestre Métropolitain, C'Chartres Spectacles)
- Sweet spot appears to be mid-size: 5-30 person organizations with dedicated admin/production staff

### Genres covered
All performing arts: theater, dance, circus, street arts, contemporary music, jazz, comedy, classical music, opera, lyric arts. Notably broad — not specialized in any single genre.

### Geographic reach
- **Primary market:** France (overwhelmingly)
- **Secondary:** French-speaking Switzerland, Belgium
- **Aspirational:** Germany/Austria (German website exists but appears to be a straight translation, no market-specific features)
- **International presence:** Very limited. One testimonial from "Allegorica" (Paolo Monacchi, Managing Director — Italian name, possibly Italian or Swiss company). One from "Machine de cirque" — Canadian (Québec) company.
- **English version exists** but feels like a translation, not a market entry strategy

---

## 4. Pricing

### What's public
- **Compagnies / Ensembles / Tourneurs:** Starting at **€67 HT/month** (annual billing) = ~€80/month with VAT = ~€960/year
- **Lieux de spectacle:** Starting at **€92 HT/month** (annual billing) = ~€110/month with VAT = ~€1,320/year
- **Orchestres & Opéras:** No public pricing (likely custom/enterprise)
- **Agents artistiques:** No public pricing

### Pricing model
- No public pricing page (returns 404)
- "Demander une demo" (request a demo) is the primary CTA — classic sales-led motion
- Pricing is modular — you pick which modules you need
- Per-organization pricing (not per-user, based on available information)
- No free tier or self-serve signup visible

### Analysis
At €67-92/month starting price, Orfeo is positioned as a mid-market tool. Not cheap enough for micro-companies (2-3 people struggling with money), not expensive enough to be enterprise-only. This aligns with Hour's proposed €49/month mid-tier from the market pricing research (product/13-market-pricing.md), but Orfeo's starting price is higher.

---

## 5. UX & Technology

### Platform
- **Web app** (primary) at orfeoapp.com
- **Mobile app** (companion — for schedule viewing and notifications, not full functionality)
- **No desktop app**

### Tech stack (confirmed)
- **Django** (Python) backend — mature, stable, but not the most modern choice for a SaaS in 2026
- **Bootstrap + jQuery** frontend — decidedly legacy. No React, Vue, or modern frontend framework detected. This is significant — it suggests the UX is functional but unlikely to feel "modern" or "snappy"
- **Version 10.3.9** — they've been iterating for years, suggesting a mature but potentially complex codebase
- **CloudFront CDN** — proper infrastructure
- **Matomo** for analytics (privacy-focused, aligns with European values)
- **New Relic** for performance monitoring (professional)

### UX observations
- No public demo or screenshots readily accessible (demo requires contact form)
- Blog content is SEO-focused operational guides, not product showcases
- Marketing site uses GravCMS — clean, professional, but static
- The testimonials consistently mention "clarity," "fluidity," and "simplicity" — suggesting the UX works but these are also the standard things people say
- Several testimonials explicitly compare it to "Excel before" — their users were previously managing everything in spreadsheets

### API
- Mentioned only in the Budget module description ("integration with analysis tools via API")
- No public API documentation found
- No developer portal or integration marketplace

---

## 6. Traction & Reputation

### Client numbers
- **Website footer (current):** "Plus de 600 structures" — up from the "500+" previously claimed
- **LinkedIn:** "more than 500 performing arts professionals"
- The number has grown from 500 to 600+ — active customer acquisition happening

### Named clients (from testimonials — 53 organizations identified)
A selection of notable ones:
- **Le Concert Spirituel** — prestigious French baroque ensemble
- **Orchestre des Pays de Savoie** — regional French orchestra
- **Orchestre Métropolitain** — major Canadian orchestra (Québec)
- **Le Poème Harmonique** — internationally touring French ensemble
- **Le Balcon** — innovative Parisian music ensemble
- **Machine de cirque** — major Québec circus company
- **C'Chartres Spectacles** — municipal venue/festival
- **Marsatac Agency** — Marseille-based booking agency
- **Robin Production** — established French production company
- **Compagnie Louis Brouillard** — major French theater company (Joël Pommerat)

### Client profile patterns
From the 53 testimonials:
- **~15 are bookers/touring companies** (Vif Tour, On the RoaD Again, 106dB, BAAM, Super!, Giant Step, Marsatac, etc.)
- **~15 are companies** (theater, dance, circus — Cheptel Aleikoum, Les Bestioles, Compagnie Jeanne Simone, etc.)
- **~10 are ensembles** (Le Concert Spirituel, Les Folies Françoises, Ensemble Aedes, etc.)
- **~8 are production companies** (Robin Production, ArtZala, Beausoir, etc.)
- **~3 are agents** (L'Agence, Jacques Thelen)
- **~2 are venues** (C'Chartres Spectacles, Scène & public)
- **Very few venues** in testimonials despite being listed first in solutions — interesting

### Press & events
- No press mentions found in my research
- No evidence of presence at Avignon, IETM, or other industry events (though they almost certainly attend — just not mentioned on the site)
- Blog is purely operational/SEO content, no press coverage or industry thought leadership
- LinkedIn: 1,995 followers — modest for a company claiming 600+ clients

### Social media
- LinkedIn only (no Twitter/X, no Instagram, no Facebook visible)
- Content appears to be mainly blog post reshares

---

## 7. Weaknesses & Gaps

### France-locked by design
This is the single biggest strategic fact about Orfeo. Their product is deeply embedded in the French performing arts ecosystem:
- **DPAE automation** — only relevant in France
- **sPAIEctacle integration** — French-only payroll software
- **Intermittents du spectacle** — uniquely French employment category
- The "Social" module is essentially useless outside France
- No multi-country tax or legal compliance features
- No multi-currency mentions anywhere

### Technology debt
- Django + Bootstrap + jQuery in 2026 is a legacy stack. It works, but:
  - Limits the speed of UX improvements
  - Makes it harder to build real-time collaborative features
  - Mobile app is likely a companion/wrapper, not a full native experience
  - Recruiting modern developers to work on jQuery is increasingly difficult

### Sales-led, no self-serve
- No way to try the product without requesting a demo
- No public pricing page
- No free tier
- This limits their growth speed and excludes smaller organizations who want to just sign up and try it

### Venue underrepresentation
Despite venues being listed first in their solutions, very few venue testimonials exist. This could mean:
- Venues are harder to win as clients
- Venues use more established venue-specific tools (ticketing systems, etc.)
- Their product is stronger for "sellers" (companies, bookers, agents) than "buyers" (venues)

### No international strategy
The German and English translations are direct word-for-word translations. No market-specific features, no local compliance, no local partnerships mentioned. This is a French product with a translated marketing site, not an international product.

### Limited integrations
- Only sPAIEctacle (French payroll) mentioned as a named integration
- No Google Calendar sync mentioned
- No accounting software integration (Sage, QuickBooks, etc.)
- No ticketing system integration
- API mentioned only once, with no documentation

### No community or content strategy
- Blog is pure SEO content, not thought leadership
- No user community, forum, or knowledge base visible
- No case studies (beyond short testimonials)
- No webinars or events presence documented

---

## 8. Hour vs Orfeo — Strategic Positioning

### Where Orfeo is stronger

1. **Established in France** — 600+ clients, 10+ years of existence, deep understanding of French performing arts admin
2. **HR/Social compliance** — DPAE, sPAIEctacle, intermittents. This is years of work that Hour would need to replicate for France
3. **Comprehensive feature set** — 10 modules covering almost everything. This is mature software
4. **Orchestra/opera niche** — specialized music library and distribution management that would be overkill for Hour's initial target
5. **Trust & references** — prestigious French clients (Le Concert Spirituel, Compagnie Louis Brouillard, Orchestre Métropolitain)

### Where Hour can differentiate

1. **International by design** — Hour's multi-country invoicing research (doc 18) already covers ES/FR/DE/IT/BE/NL/UK/PT. Orfeo is France-only. Any company that tours outside France (or isn't French) hits Orfeo's ceiling immediately.

2. **Modern tech stack** — Hour can build real-time collaboration, modern UX, true mobile-first experience. Orfeo's Django+jQuery stack will struggle to match this.

3. **Self-serve + lower entry price** — Hour's proposed €19/month solo tier undercuts Orfeo's €67 minimum. A free tier or trial would capture the small companies Orfeo can't reach with their sales-led model.

4. **Diffusion-first approach** — Hour starts with the booking/outreach workflow (the hardest, most relationship-intensive part of performing arts work). Orfeo treats "Vente" as one module among ten. Hour can be deeper and better at this specific workflow.

5. **Non-French markets** — Spain, Catalonia, Germany, Benelux, UK, Nordics — Orfeo doesn't exist here. Hour has open field.

6. **AI capabilities** — Hour's AI integration research (doc 10) is a generational advantage. Orfeo shows zero AI features. Auto-enrichment of contacts, smart follow-up suggestions, natural language search — these would be transformative for performing arts professionals drowning in admin.

7. **Multi-channel communications** — WhatsApp, Telegram integration (doc 11) vs. Orfeo's basic email sync. Performing arts professionals increasingly communicate via messaging apps, especially for touring logistics.

### Could they coexist?
Yes, partially. For a French company that never tours outside France, Orfeo is the established choice with deep local compliance. For a Spanish company touring in France, or a French company touring internationally, or any non-French company — Orfeo is not an option.

**However:** If Hour builds serious French compliance (DPAE, intermittents), it becomes a direct threat to Orfeo on their home turf, because it would offer everything Orfeo does PLUS international capability PLUS modern UX PLUS lower price point. This is the classic "new entrant with modern stack vs. incumbent with legacy" pattern.

### Recommended positioning for France

1. **Don't compete head-on initially.** Don't try to out-feature Orfeo's French compliance on day one. Instead:

2. **Target French companies that tour internationally.** They already feel Orfeo's limitations. They need multi-country invoicing, multi-language contracts, international contact management. Orfeo can't give them this. Hour can.

3. **Target non-classical genres.** Orfeo's client base skews heavily toward classical music (ensembles, orchestres, opéras) and established French production companies. Contemporary dance, circus, indie music, and street arts companies are less represented — and these are also the genres that tour most internationally.

4. **Lead with diffusion + modern UX.** The performing arts professionals who are most frustrated with existing tools are the ones doing booking outreach — cold emails, follow-ups, tracking conversations with 200+ programmers. Make Hour's diffusion module dramatically better than Orfeo's "Vente" module.

5. **Phase in French compliance later.** Once Hour has traction with international-touring French companies, add DPAE and sPAIEctacle integration. By then, the switching cost from Orfeo becomes justified by the international capabilities.

6. **Price aggressively.** Orfeo starts at €67/month. Hour at €19 or even free for solo users creates a massive adoption funnel that Orfeo's sales-led model can't match.

---

## Key Facts Summary

| Dimension | Orfeo |
|-----------|-------|
| Founded | 2012 (SAS) / 2015 (product launch) |
| HQ | Rennes, France |
| Team | ~20-25 people |
| Funding | Bootstrapped (no evidence of VC) |
| Clients | 600+ organizations |
| Primary market | France |
| Pricing | From €67/month (annual) |
| Tech stack | Django, Bootstrap, jQuery, CloudFront |
| Mobile | Companion app (not full-featured) |
| Languages | FR, EN, DE (translations only) |
| API | Mentioned once, no public docs |
| Key strength | Deep French performing arts compliance |
| Key weakness | France-only, legacy tech, no self-serve |
