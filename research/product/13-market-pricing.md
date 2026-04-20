# Market Analysis & Pricing Strategy

> Last updated: 2026-04-20
> Status: initial analysis — pending validation with Phase 0 usage data

---

## 1. Market segments

### A. Booking agency tools (reference, not direct competition)
| Tool | Price | Model | HQ |
|------|-------|-------|----|
| Stagent | 99-799 €/mo | Per roster size | Netherlands |
| SystemOne | 35-1188 €/mo | Per agent seat | Berlin |
| ABOSS | 131-522 €/mo | Per calendar count | Amsterdam |
| Overture | ~$1,210/license | Perpetual | Brighton |
| Gigwell | $33-199/mo | Per plan | US |
| Prism.fm | ~$625/mo | Custom | US |
| Muzeek | $0-99/user/mo | Per user | Australia |

### B. Venue/enterprise (irrelevant — different world)
Tessitura ($8k+/mo), Spektrix, Yesplan (320-990 €/mo), Artifax ($250-450/user/mo). Wrong segment.

### C. Direct competitors (Hour's actual space)
| Tool | Price | What it does | Gap vs Hour |
|------|-------|-------------|-------------|
| Ares | 30-60 €/mo | Spanish labor compliance + basic gig ops | No difusion, no production, no multi-country |
| Propared | $112-299/mo | Production planning | No booking outreach, US-centric |
| StageSwift | "cups of coffee" | Tour scheduling + logistics | No CRM, tiny, UK only |

---

## 2. The whitespace

No tool serves a mid-size European performing arts company from difusion through production and invoicing. Every competitor is either:
1. Agency-side (wrong user perspective)
2. Production-only (no outreach)
3. Venue-side (company is supplier, not user)
4. Labor compliance only (Ares)

**Hour's true competitor is inertia: Excel + WhatsApp + email + Google Drive.**

---

## 3. Pricing proposal

### Why NOT per-user
Per-user penalizes adoption. In a performing arts company, you want the lighting tech, stage manager, producer, admin, and artists ALL using the tool. Charge per user and only 2-3 people enter — the rest stays on WhatsApp. Hour's value is everyone working there. Charge per workspace, not per seat.

### Proposed tiers

| Plan | Price/mo | Annual | Target | Key limits |
|------|----------|--------|--------|------------|
| **SOLO** | 19 € | 190 €/yr (15.83 €/mo) | Solo artist / duo | 1 House, 2 Rooms, 2 users, 500MB |
| **COMPANY** | 49 € | 490 €/yr (40.83 €/mo) | Company 3-10 people | 1 House, unlimited Rooms, 10 users, 5GB |
| **PRO** | 99 € | 990 €/yr (82.50 €/mo) | Company 10+ or multi-production | Unlimited Houses/Rooms/users, 50GB, API |

### Why these numbers
- **19 € (not 25 €)**: Cheaper than Ares Lite AND offers difusion (which Ares doesn't). No-brainer to try.
- **49 € (not 60 €)**: 18% cheaper than Ares General with significantly more features.
- **99 € (not 120 €)**: Below the 100 € psychological barrier. For a company billing 200-500k €/yr, it's 0.02-0.06% of revenue — invisible.

### Extras
- Storage: 5 €/mo per 10GB extra (low real cost with R2)
- Migration service: 150 € one-time (same as Ares setup, but optional)
- Custom onboarding: 200 € (2h session + configuration, on request only)
- Trial: 14 days free, no credit card. Critical for this sector.

---

## 4. Revenue timeline

| Period | Milestone | Paying customers | MRR |
|--------|-----------|-----------------|-----|
| Months 1-6 (Apr-Sep 2026) | Phase 0. MaMeMi as internal pilot. | 0 | 0 € |
| Month 7 (Oct 2026) | Phase 1 launch. Trial. 5 early adopters from Marco's circuit. | 0-2 | 0-98 € |
| Months 8-12 (Nov 2026 - Mar 2027) | Word of mouth in Catalan/Spanish circuit. Autumn fair season. | 5-12 | 245-588 € |
| Month 12 (Mar 2027) | First anniversary. First customers outside Spain. | 10-20 | 490-1,470 € |
| Months 13-18 (Apr-Sep 2027) | Organic growth. Presence at 2-3 fairs/markets. Content. | 20-40 | 980-2,940 € |
| Month 24 (Mar 2028) | Critical mass for side-business viability. | 40-80 | 1,960-5,880 € |
| Month 36 (Mar 2029) | Consolidated in European circuit. | 80-150 | 3,920-11,025 € |

### Breakeven
- **As side-business** (infra + some of Marco's hours): ~15-20 customers, MRR ~750-1,000 €. Achievable month 12-15.
- **As dedicated business** (1 salary + infra + marketing): ~80-100 customers, MRR ~4,000-5,000 €. Achievable month 24-36.

### Market size (TAM/SAM/SOM)
- Professional touring companies in Spain: ~800-1,500
- Europe total: ~8,000-15,000
- **TAM**: 15,000 companies x 49 €/mo avg x 12 = ~8.8M €/yr
- **SAM** (Western EU, SaaS-ready): ~4,000 = ~2.4M €/yr
- **SOM** (3-5 year realistic): 150-300 companies = 88-176k €/yr

Small market. Not a unicorn. A solid niche business with high margins (infra on free/low tiers).

---

## 5. Growth model

### Primary: fairs and performing arts markets (presential word of mouth)
This sector does NOT work with digital marketing. Companies don't Google "performing arts management software." They learn at:
- Fairs: Mostra Igualada, Fira Tàrrega, FETEN (Gijon), Mercartes, Cinars (Montreal), IETM, ISPA
- Word of mouth between companies at every fair
- Production networks: Red de Teatros, Platea, European venue networks

Marco is already in this circuit. Marginal cost of presenting Hour is low (500-1,500 €/fair for accreditation + travel).

### Secondary: specialized content
Blog/newsletter about touring company management. Real value content only someone from the sector can write. Positions Hour as the reference tool.

### Tertiary: partnerships
- Culture-specialized accountancy firms (gestorias): symbiotic — they do compliance, Hour does everything else
- Venue/programmer networks: if a programmer receives dossiers managed with Hour and they're better/more consistent, they recommend the tool
- Ares integration: counterintuitive but symbiotic — Ares for compliance, Hour for difusion+production

### What NOT to do
- Paid ads: TAM too small, CPA would be astronomical
- Cold email outreach: sector allergic to aggressive sales
- Unlimited freemium: TAM too small, every free user should be paying

---

## 6. Assumptions to validate in Phase 0

- [ ] Do performing arts companies actually use a difusion CRM daily? (or is it seasonal bursts?)
- [ ] What's the minimum feature set that makes someone pay 19-49 €/mo?
- [ ] Is the "no per-user" model sustainable at scale or does it invite abuse?
- [ ] What's the real storage need per company per year?
- [ ] How important is mobile vs desktop for daily work?
