# Multi-Country Invoicing, Legal & i18n Requirements

> Research for Hour — B2B SaaS for performing arts companies touring Europe.
> Date: April 2026. Sources cited inline. Where data is thin or uncertain, noted explicitly.

---

## 1. E-Invoicing Requirements by Country

### EU-Wide: ViDA (VAT in the Digital Age)

The EU adopted the ViDA package in early 2025. Key dates:

| Date | What happens |
|------|-------------|
| 2025 | Member states no longer need EC approval to mandate domestic e-invoicing |
| July 2028 | Mandatory reverse charge for non-established suppliers; single VAT registration (OSS extension) |
| July 2030 | Mandatory e-invoicing for all cross-border B2B intra-EU transactions (EN 16931 standard) |
| Jan 2035 | Harmonization deadline for pre-2024 domestic systems with EU standards |

This means **by 2030, any cross-border B2B invoice in the EU must be a structured e-invoice** (not PDF). Hour needs to be ready for this.

Sources: [EC ViDA adoption](https://taxation-customs.ec.europa.eu/news/adoption-vat-digital-age-package-2025-03-11_en), [Marosa VAT](https://marosavat.com/vat-news/vat-in-the-digital-age), [vatcalc](https://www.vatcalc.com/eu/eu-2028-digital-reporting-requirements-drr-e-invoice/)

---

### Spain (primary market)

**Three parallel systems:**

#### SII (Suministro Inmediato de Información)
- **Who:** Companies with turnover > €6M/year, REDEME scheme, VAT groups
- **What:** Real-time reporting of invoice data to AEAT within 4 days
- **Status:** Already mandatory since 2017

#### Verifactu
- **Who:** All other Spanish taxpayers NOT on SII
- **When:** Legal entities by **January 2027**; sole traders by **July 2027** (delayed from 2026 via Real Decreto-ley 15/2025)
- **What:** Certified invoicing software must generate QR codes, include "VERIFACTU" text, guarantee invoice chain integrity
- **Software deadline:** By July 29, 2025, billing software must be adapted; non-compliant software cannot be sold after that date

#### B2B E-Invoicing Mandate
- **When:** Expected ~2028 (24 months after final regulations published, likely 2026)
- **What:** All B2B invoices must be structured electronic invoices

#### TicketBAI (Basque Country only)
- Separate system for Álava, Gipuzkoa, Bizkaia — already fully mandatory
- Applies to ALL transactions (B2B + B2C)
- Requires XML with digital signature, QR codes, real-time reporting to Basque Hacienda
- Penalties: up to 20% of prior year turnover (min €20,000) for non-compliance
- **Excluded from the national B2B mandate** — runs its own system

#### Required invoice fields (Spain)
- Invoice number and series
- Issue date (and operation date if different)
- Supplier: legal name, NIF/CIF, address
- Customer: legal name, address (NIF required for intra-EU/reverse charge)
- Description of goods/services
- Unit price (pre-tax)
- VAT rate(s) and amount per rate, shown separately
- Tax base per rate
- Total amount
- From 2025+: QR code and VERIFACTU identifier

Sources: [Marosa Verifactu guide](https://marosavat.com/vat-news/verifactu-spain-2026-guide), [peppol.nu](https://www.peppol.nu/blog-items/spaanse-e-invoicing-2026-verifactu/), [vatcalc delay](https://www.vatcalc.com/spain/spain-verifactu-delay-till-jan-2027-for-certified-e-invoicing/), [getrenn](https://getrenn.com/blog/mandatory-invoice-details), [invoiceness](https://invoiceness.com/en/blog/how-to-create-invoice-in-spain)

---

### France

| Date | Obligation |
|------|-----------|
| **September 1, 2026** | All companies must **receive** e-invoices. Large + mid-cap companies must **issue** e-invoices |
| **September 1, 2027** | SMEs and micro-companies must **issue** e-invoices |

- **Formats:** UBL 2.1, UN/CEFACT CII, Factur-X (hybrid PDF/XML)
- **Platform:** Must use a state-approved PDP (Plateforme de Dématérialisation Partenaire)
- **Penalties:** €15/invoice, max €15,000/year (first infraction may be exempt if corrected)
- **Scope:** All B2B transactions between VAT-registered companies established in France

Sources: [Vertex](https://www.vertexinc.com/resources/resource-library/frances-2026-e-invoicing-mandate-what-businesses-need-know), [EY](https://www.ey.com/en_gl/technical/tax-alerts/french-government-announces-simplification-measures-as-part-of-september-2026-e-invoicing-mandate), [Basware](https://www.basware.com/en/compliance/e-invoicing-mandate-france/)

---

### Germany

| Date | Obligation |
|------|-----------|
| **January 1, 2025** | All businesses must be able to **receive** e-invoices |
| **January 1, 2027** | Businesses with turnover > €800K must **issue** e-invoices |
| **January 1, 2028** | All businesses must issue e-invoices for domestic B2B |

- **Formats:** EN 16931 compliant — XRechnung or ZUGFeRD (COMFORT/EXTENDED)
- **Exemptions:** B2C, invoices < €250, passenger tickets, VAT-exempt sales, intra-EU transactions (those will fall under ViDA by 2030)
- **Archiving:** 10 years in original format
- **No central platform required** (unlike France/Italy)

Sources: [Marosa](https://marosavat.com/vat-news/german-e-invoicing-guide), [VATupdate](https://www.vatupdate.com/2026/03/24/germany-e-invoicing-b2b-mandate-timeline-and-compliance/), [cleartax](https://www.cleartax.com/de/en/e-invoicing-germany)

---

### Italy

- **Status:** Already mandatory since 2019 for all B2B, B2C, B2G transactions
- **System:** SDI (Sistema di Interscambio) — all invoices must pass through government exchange platform
- **Format:** FatturaPA XML (aligned with EN 16931)
- **Submission deadline:** Within 12 days of transaction; deferred invoices by 15th of following month
- **Foreign companies:** If NOT established in Italy and without Italian VAT number → NOT required to issue through SDI. The Italian client self-invoices.
- **If you HAVE Italian VAT registration:** Must issue through SDI

Sources: [globalvatcompliance](https://www.globalvatcompliance.com/globalvatnews/italy-e-invoicing-compliance-2025/), [Storecove SDI](https://www.storecove.com/blog/en/sdi-italy/), [comarch](https://www.comarch.com/trade-and-services/data-management/e-invoicing/e-invoicing-in-italy/)

---

### Belgium

- **Mandate:** January 1, 2026 — all domestic B2B invoices must be structured e-invoices
- **Format:** EN 16931, via Peppol BIS Billing 3.0
- **Network:** Peppol (mandatory)
- **Grace period:** Q1 2026 — no sanctions if reasonable compliance steps taken
- **B2C:** Not included
- **Future:** E-reporting via Peppol planned for 2028

Sources: [Vertex Belgium](https://www.vertexinc.com/resources/resource-library/belgiums-2026-e-invoicing-regulations-explained-scope-deadlines-and-penalties), [ING](https://www.ing.be/en/business/payments/peppol-mandatory), [Marosa](https://marosavat.com/vat-news/e-invoicing-b2b-belgium-complete-guide-january-2026)

---

### Netherlands

- **Current:** No B2B mandate. E-invoicing voluntary (buyer consent required)
- **B2G:** Government organizations must receive via Peppol
- **Future:** Peppol-based B2B mandate planned for **July 2030** (aligned with ViDA)
- **No action needed for Hour v1**

Sources: [VATupdate NL 2030](https://www.vatupdate.com/2025/10/25/netherlands-plans-mandatory-peppol-based-b2b-e-invoicing-regime-by-july-2030/), [pagero](https://www.pagero.com/compliance/regulatory-updates/netherlands)

---

### UK (post-Brexit)

- **Current:** No mandatory e-invoicing. Making Tax Digital covers VAT record-keeping digitally
- **Future:** Mandatory B2B e-invoicing from **April 2029** (consultation ongoing, roadmap at Budget 2026)
- **Format:** Likely EN 16931 based (UBL/XML)
- **No action needed for Hour v1**

Sources: [EDICOM UK](https://edicomgroup.com/blog/united-kingdom-electronic-invoicing-b2b-b2g), [vatcalc](https://www.vatcalc.com/united-kingdom/uk-2029-mandatory-b2b-e-invoicing/), [KPMG](https://kpmg.com/uk/en/insights/tax/tmd-autumn-budget-electronic-invoicing.html)

---

### Portugal

- **ATCUD:** Unique Document Code required on all invoices (mandatory)
- **QR Code:** Required on all invoices
- **QES (Qualified Electronic Signature):** Required from January 1, 2027 for PDF invoices
- **SAF-T:** Accounting file for 2026 transactions due in 2028
- **B2G:** Already mandatory for large taxpayers; full coverage by 2026
- **Format:** CIUS-PT (UBL 2.1 or CEFACT) with QES

Sources: [KPMG Portugal](https://kpmg.com/us/en/taxnewsflash/news/2025/12/portugal-postponement-mandatory-qes-saft-requirements.html), [Sovos Portugal](https://sovos.com/vat/tax-rules/portugal-e-invoicing/), [cleartax](https://www.cleartax.com/pt/en/e-invoicing-portugal)

---

### Summary Table

| Country | B2B E-Invoice Mandatory | Format | Central Platform | Priority for Hour |
|---------|------------------------|--------|-----------------|-------------------|
| **Spain** | ~2028 (Verifactu Jan 2027) | EN 16931 + Verifactu | SII/Verifactu | **Critical — v1** |
| **France** | Sep 2026 (receive) / Sep 2027 (issue for SMEs) | UBL/CII/Factur-X | PDP (state-approved) | **High — v1** |
| **Germany** | Jan 2028 (all) | XRechnung/ZUGFeRD | None | **High — v1** |
| **Italy** | Already mandatory | FatturaPA XML | SDI | Medium — v1.x |
| **Belgium** | Jan 2026 | Peppol BIS | Peppol | Medium — v1.x |
| **Netherlands** | ~2030 | Peppol | Peppol | Low — v2 |
| **UK** | ~2029 | TBD (EN 16931) | TBD | Low — v2 |
| **Portugal** | B2G only + ATCUD | CIUS-PT | AT portal | Medium — v1.x |

#### What this means for Hour
- **v1 must generate valid invoices for Spain** — Verifactu-ready with QR codes, sequential numbering, proper NIF handling
- **v1 should support export in structured formats** (UBL, Factur-X at minimum) for France/Germany compliance
- Hour is NOT an accounting system — it generates invoices that feed into one. But the invoices must contain all mandatory fields
- **Integration with e-invoicing networks** (Peppol, SDI) can be done via middleware (Storecove, Basware, Qvalia) rather than building direct connections

---

## 2. Intra-Community VAT for Performing Arts

### Place of Supply Rules

Performing arts have a **special exception** to the general B2B rule:

- **General B2B rule:** VAT charged where the customer is established
- **Exception for event admission:** Admission to cultural/entertainment events is taxed **where the event takes place** (Article 53, VAT Directive)
- **Other services** (e.g., production fees, management fees, creative services): Follow the general B2B rule — taxed where the customer is established

**Practical example:** A Spanish company performs at a festival in France:
- The festival ticket sales → French VAT applies (place of event)
- The fee the festival pays to the Spanish company → Depends on the nature:
  - If it's "admission-related" → French VAT
  - If it's a B2B service fee → Reverse charge, customer (French festival) self-assesses VAT

### Reverse Charge Mechanism

When a Spanish company invoices a French company for B2B services:
1. Spanish company issues invoice **without VAT** (0%)
2. Invoice states: "Reverse charge — Article 196 VAT Directive"
3. French company self-assesses French VAT on the purchase
4. French company deducts same amount as input VAT (net zero if fully deductible)

**Requirements for reverse charge:**
- Both parties must be VAT-registered
- Both must have valid VIES-registered VAT numbers
- Invoice must reference the reverse charge provision

### VAT Registration Thresholds

**New SME Scheme (from January 1, 2025):**
- Domestic threshold: up to €85,000
- Cross-border threshold: up to €100,000 (cumulative across all EU)
- Special "EX" identifier required
- Only for EU-resident businesses

**Key point:** For performing arts touring companies, the reverse charge mechanism means they typically do NOT need to VAT-register in every country they perform in, as long as:
- They're invoicing B2B (to festivals, theaters, venues)
- The service qualifies for reverse charge
- Ticket sales are handled by the local promoter/venue

### How Existing Tools Handle This

| Tool | Multi-country VAT | Verdict |
|------|-------------------|---------|
| **Holded** | Spanish-focused, Facturae XML beta, limited multi-country | Good for Spain only |
| **Xero** | UK VAT only, no multi-country filing | Needs third-party (Avalara/Avask) |
| **QuickBooks** | Similar to Xero — not designed for multi-country VAT | Same limitation |
| **Avalara** | Middleware for VAT calculation/filing across EU | Integration partner, not standalone |

**Gap for Hour:** None of these tools understand the performing arts place-of-supply exception. Hour can add real value by encoding these rules into its invoice generation logic.

Sources: [EC place of taxation](https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/place-taxation_en), [Avalara reverse charge](https://www.avalara.com/us/en/vatlive/eu-vat-rules/eu-vat-returns/reverse-charge-on-eu-vat.html), [Fonoa](https://www.fonoa.com/resources/blog/eu-reverse-charge-what-is-it-and-who-is-it-for)

---

## 3. VAT Rates for Performing Arts

### Reduced VAT on Cultural Events (Admission)

| Country | Standard Rate | Cultural/Performing Arts Rate | Notes |
|---------|--------------|------------------------------|-------|
| **Spain** | 21% | **10%** | Reduced from 21% in 2017 after sector advocacy |
| **France** | 20% | **5.5%** (concerts), **2.1%** (first 140 performances of same show) | Super-reduced for new productions |
| **Germany** | 19% | **7%** | Reduced rate for cultural admissions |
| **Italy** | 22% | **10%** (standard cultural), **5%** (some 2025 changes) | Rate varies by specific service |
| **Belgium** | 21% | **6%** | Cultural events |
| **Netherlands** | 21% | **9%** | Cultural events |
| **UK** | 20% | **0%** (some cultural admissions by eligible bodies) | Complex rules, charity-dependent |
| **Portugal** | 23% | **6%** | Cultural events |
| **Austria** | 20% | **13%** | Cultural admissions |
| **Luxembourg** | 17% | **3%** | Performing arts |
| **Sweden** | 25% | **6%** | Cultural events |
| **Denmark** | 25% | **25%** (no reduced rate for culture) | Exception: some exempt |
| **Norway** | 25% | **12%** | Cinema, sports; culture may be exempt |

*Note: Rates for performing arts are not always clearly distinguished from general "cultural admissions" in legislation. The rates above are best-effort from multiple sources. Always verify with local tax authority.*

Sources: [Live DMA VAT](https://live-dma.eu/vat-in-the-european-live-music-sector/), [polishtax](https://polishtax.com/vat-rates-per-country-in-the-european-union-2025-update/)

### Withholding Tax on Artist Fees

This is one of the biggest pain points for touring companies.

| Country | Withholding Rate | Basis | Notes |
|---------|-----------------|-------|-------|
| **Italy** | **30%** | Gross | Highest in EU |
| **Spain** | **24%** (non-resident) | Gross | 19% for EU/EEA residents |
| **Germany** | **15.825%** | Gross | 15% + solidarity surcharge |
| **Sweden** | **15%** | Gross | SINK tax |
| **Finland** | **15%** | Gross | |
| **France** | **15%** | Gross | May be reduced by treaty |
| **Belgium** | **18%** | Gross | |
| **Portugal** | **25%** | Gross | |
| **Austria** | **20%** | Gross | |
| **UK** | **20%** (basic) | Gross | Reduced by treaty for some |
| **Luxembourg** | **10%** | Gross | |
| **Netherlands** | **0%** | N/A | No withholding |
| **Denmark** | **0%** | N/A | No withholding |
| **Ireland** | **0%** | N/A | No withholding |
| **Hungary** | **0%** | N/A | No withholding |

**Critical issues:**
- Tax is on **gross fees** — no deduction for costs (travel, accommodation, crew)
- Small/medium companies often **overpay** because their margin is thin
- US artists get treaty exemptions (typically ~$20K threshold) that EU artists don't get from each other
- Reclaiming overpaid withholding tax is bureaucratic and can take years
- Double taxation treaties exist but are bilateral and inconsistent

Sources: [Culture Action Europe policy paper](https://cultureactioneurope.org/advocacy/emma-calls-for-changes-to-withholding-tax-for-european-touring-artists/), [Billboard](https://www.billboard.com/pro/touring-tax-measures-europe-music-artist-groups-solutions/), [touring-artists.info](https://www.touring-artists.info/en/income-tax/business-to-germany/withholding-tax-performance)

#### What this means for Hour
- Hour should store withholding tax rates per country and apply them when generating invoices or calculating net income from a gig
- Show the **net amount after withholding** alongside the gross fee — this is what the company actually receives
- Track withholding tax paid per country per year (needed for annual tax return / reclaim)
- Flag when a double-taxation treaty might reduce the rate

---

## 4. Contract Templates

### Standard Elements for Performing Arts Contracts

Based on industry practice (not EU-mandated standard):

1. **Parties** — Full legal names, VAT/tax IDs, registered addresses
2. **Engagement details** — Venue, date(s), times (load-in, soundcheck, show, load-out)
3. **Performance specification** — Type, duration, number of performers, repertoire/show title
4. **Financial terms** — Fee (gross), currency, withholding tax clause, payment schedule (deposit + balance), payment method, deadline
5. **Technical rider** — Reference to attached technical requirements
6. **Hospitality rider** — Accommodation, catering, transport provisions
7. **Cancellation/Force majeure** — Terms for both sides, deposit handling
8. **Insurance** — Liability, equipment, cancellation insurance requirements
9. **Intellectual property** — Recording rights, streaming, photography, archival
10. **Marketing** — Logo usage, billing order, approval rights
11. **Applicable law and jurisdiction** — Which country's law governs
12. **Signatures** — Authorized representatives

### Country-Specific Considerations

**Language requirements for B2B commercial contracts:**

| Country | Requirement |
|---------|------------|
| **Spain** | No strict requirement for B2B; can be in any language. Courts prefer Spanish for enforcement |
| **Catalonia** | No mandatory language for private documents (Article 15, language policy) |
| **France** | Toubon Law does NOT apply to international B2B contracts — parties choose the language |
| **Germany** | No legal requirement, but courts operate in German. Bilingual recommended |
| **Italy** | No strict B2B requirement. Courts operate in Italian |
| **Belgium** | Flanders region: contracts with employees must be in Dutch. B2B: no mandate |
| **UK** | English, no issues |

**Practical approach for touring:** Most performing arts contracts in Europe are bilingual (English + local language) or English-only with a governing law clause.

**Country-specific clauses to watch:**
- **Germany:** Withholding tax clause (who bears the cost), AKM/GEMA royalty obligations
- **France:** Intermittent du spectacle status (affects how local crew is hired), SACEM declarations
- **Italy:** High withholding (30%) must be explicitly addressed in fee negotiation
- **Spain:** IRPF retention for non-residents, SGAE/AIE obligations

Sources: [Performing Arts Forum contracts](https://www.performingartsforum.ie/contracts/), [Romano Law](https://www.romanolaw.com/nine-clauses-to-include-in-your-live-music-agreement/), [ACC language requirements](https://www.acc.com/resource-library/mandatory-use-national-languages-contractual-documents-european-perspective)

#### What this means for Hour
- Hour should provide **contract templates** with pre-filled data from the gig/show record
- Templates should auto-include the correct withholding tax clause based on performance country
- Support for **PDF generation** in multiple languages (at least EN + ES + FR)
- Contract fields should map to invoice fields (same parties, amounts, dates)
- Store signed contracts linked to the gig record

---

## 5. Currency Handling

### Euro vs Non-Euro Countries (relevant touring markets)

**Euro (EUR):** Spain, France, Germany, Italy, Belgium, Netherlands, Portugal, Austria, Finland, Ireland, Luxembourg, Greece, Estonia, Latvia, Lithuania, Slovakia, Slovenia, Malta, Cyprus, Croatia

**Non-Euro currencies for touring:**

| Currency | Country | Notes |
|----------|---------|-------|
| GBP | UK | Major touring market, significant exchange rate volatility |
| SEK | Sweden | Common Nordic touring destination |
| NOK | Norway | Common Nordic touring destination (not EU) |
| DKK | Denmark | Pegged to EUR (±2.25%), very stable |
| CHF | Switzerland | Not EU, strong currency, high-fee market |
| CZK | Czech Republic | Growing touring market |
| PLN | Poland | Growing touring market |
| HUF | Hungary | Growing touring market |
| RON | Romania | Occasional touring |

### Exchange Rate Management

**Approaches for a small SaaS:**
1. **Store amounts in original currency** — Always preserve what was actually invoiced/contracted
2. **Use ECB reference rates** — Free, daily, official. API: `https://data.ecb.europa.eu/`
3. **Convert to EUR for reporting** — Use the rate on the invoice date (standard accounting practice)
4. **Don't try to be a forex platform** — Show the rate used, let accountants handle gains/losses

**Invoice requirements:** When invoicing in a non-EUR currency from a EUR-based company:
- Invoice can be in any currency agreed between parties
- For Spanish tax purposes, the EUR equivalent must be declared (using ECB rate on invoice date)
- Some countries require the invoice amount in local currency

#### What this means for Hour
- Store all monetary amounts with their currency code (ISO 4217)
- Support at minimum: EUR, GBP, SEK, NOK, DKK, CHF
- Show EUR equivalent on non-EUR invoices (for Spanish companies' tax reporting)
- Use ECB daily reference rates — cache them, update daily
- In gig/tour financial summaries, convert everything to EUR using invoice-date rates

---

## 6. i18n Technical Requirements

### Date Formats

| Country | Common Format | Note |
|---------|--------------|------|
| Spain | DD/MM/YYYY | |
| France | DD/MM/YYYY | |
| Germany | DD.MM.YYYY | Dot separator |
| Italy | DD/MM/YYYY | |
| UK | DD/MM/YYYY | |
| Netherlands | DD-MM-YYYY | Hyphen separator |
| Sweden | YYYY-MM-DD | ISO 8601 |
| Norway | DD.MM.YYYY | |
| Denmark | DD.MM.YYYY or DD-MM-YYYY | |
| Portugal | DD/MM/YYYY | |

**Implementation:** Use `Intl.DateTimeFormat` with the user's locale. Don't hardcode.

### Number/Currency Formatting

| Convention | Countries |
|-----------|-----------|
| Decimal **comma**, thousands **period** (1.234,56) | Spain, France, Germany, Italy, Belgium, Netherlands, Portugal, Sweden, Norway, Denmark |
| Decimal **period**, thousands **comma** (1,234.56) | UK, Ireland |

**Implementation:** Use `Intl.NumberFormat`. Store numbers as integers (cents) internally.

### Address Formats

| Country | Format | Postal Code Position |
|---------|--------|---------------------|
| Spain | Street + Number, Floor/Door / Postal Code + City / Province | Before city |
| France | Street + Number / Postal Code + City | Before city |
| Germany | Street + Number / Postal Code + City | Before city |
| Italy | Street + Number / Postal Code + City + Province | Before city |
| UK | Street + Number / City / County / Postal Code | After city |
| Netherlands | Street + Number / Postal Code + City | Before city |
| Portugal | Street + Number / Postal Code + City | Before city |

**Implementation:** Use [Google's `libaddressinput`](https://github.com/google/libaddressinput) or [geoapify address format templates](https://www.geoapify.com/address-formats-by-country-json/) as reference. Store address components separately, render per locale.

### Name Order

All target countries use Western name order (given name + family name). No special handling needed for European markets. Some countries commonly use two surnames (Spain: first surname + second surname).

Sources: [Wikipedia date formats](https://en.wikipedia.org/wiki/Date_and_time_notation_in_Europe), [Wikipedia decimal separator](https://en.wikipedia.org/wiki/Decimal_separator), [geoapify](https://www.geoapify.com/address-formats-by-country-json/)

#### What this means for Hour
- Use `Intl` APIs throughout — never format dates/numbers manually
- Store user locale preference (BCP 47 tag: `es-ES`, `fr-FR`, `de-DE`, etc.)
- Invoices/contracts must render in the correct locale format
- Address fields: store components separately (street, number, floor, postal_code, city, province, country)
- Spanish double surnames: allow two surname fields

---

## 7. GDPR Implications

### Core Requirements for a SaaS with EU-Wide Users

Hour will store personal data (names, emails, phones, addresses, tax IDs, bank details) of contacts across the EU.

**Key obligations:**

1. **Legal basis for processing** — Legitimate interest (B2B contact management) or contract performance. Consent not typically needed for B2B operational data, but needed for marketing
2. **Data minimization** — Only collect what's needed. A venue contact's birthday is not needed; their tax ID is
3. **Data Processing Agreement (DPA)** — Hour must offer a DPA to all customers (standard, self-serve)
4. **Privacy policy** — Clear, accessible, listing what data is collected, why, how long retained, and data subject rights
5. **Data subject rights** — Right to access, rectification, erasure, portability. Must be technically feasible in the system
6. **Data breach notification** — 72 hours to notify supervisory authority
7. **Records of processing** — Document what data is processed, by whom, for what purpose

### Data Hosting

- **GDPR does not mandate EU hosting**, but it's the simplest path
- Transfers outside EEA require adequacy decisions or Standard Contractual Clauses (SCCs)
- US hosting: covered by EU-US Data Privacy Framework (adequacy decision exists since 2023)
- **Recommendation for Hour:** Host on EU infrastructure (Cloudflare EU, Hetzner, or similar). Removes transfer complexity entirely

### EU Data Act (from September 2025)

- Applies to cloud/SaaS providers serving EU customers
- Requires: switching support, interoperability, data portability
- Practical impact on Hour: must allow data export in standard format, can't lock customers in

### Performing-Arts-Specific Considerations

- **Artist personal data** (real names, tax IDs, bank accounts) is sensitive from a privacy perspective even if not "special category" under GDPR
- **Crew/technician data** crosses into employment/HR territory if Hour stores it
- **Contact databases** for venues/festivals are shared across companies — need clear ownership model
- **Photos/media** of artists: separate consent may be needed if used for marketing vs. operational purposes

Sources: [digitalsamba](https://www.digitalsamba.com/blog/does-gdpr-require-eu-data-hosting), [secureprivacy](https://secureprivacy.ai/blog/saas-privacy-compliance-requirements-2025-guide), [EC data protection rules](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/obligations/what-rules-apply-if-my-organisation-transfers-data-outside-eu_en)

#### What this means for Hour
- Implement data export (JSON/CSV) for GDPR portability from day one
- DPA template: prepare one, offer on signup
- Privacy policy: have one before launch
- Host in EU
- Build "delete contact" that actually deletes (not soft-delete) or anonymizes
- Tax IDs and bank details: encrypt at rest
- Don't store data you don't need

---

## 8. Implementation Roadmap

### v1 — Must Have (Launch)

| Feature | Reason |
|---------|--------|
| **Spanish invoice generation** with all mandatory fields | Primary market, Verifactu coming Jan 2027 |
| **QR code on invoices** | Required for Verifactu |
| **Sequential invoice numbering** with series | Spanish legal requirement |
| **Reverse charge invoicing** | Every touring company invoices cross-border |
| **VAT rate lookup per country** (at least for performing arts) | Needed for correct invoicing |
| **Multi-currency support** (EUR + GBP + SEK + NOK + DKK + CHF) | Touring reality |
| **ECB exchange rate integration** | For EUR equivalents |
| **Withholding tax per country** (display + track) | Financial reality of touring |
| **Locale-aware formatting** (dates, numbers, addresses) | Using `Intl` APIs |
| **GDPR basics** (privacy policy, DPA, data export, EU hosting) | Legal requirement |
| **Contract template generation** (PDF, at least EN + ES) | Core value proposition |
| **Contact data with proper address components** | Needed for invoicing |

### v1.x — Next (3-6 months post-launch)

| Feature | Reason |
|---------|--------|
| **Structured e-invoice export** (UBL 2.1 / Factur-X) | France mandate Sep 2026 |
| **XRechnung/ZUGFeRD export** | Germany mandate Jan 2027-2028 |
| **Withholding tax annual summary** per country | For tax returns |
| **Contract templates in FR + DE** | Key touring markets |
| **ATCUD support** for Portugal | If Portuguese market grows |
| **Peppol integration** via middleware (Storecove/Qvalia) | Belgium mandate, future EU standard |

### v2 — Later (12+ months)

| Feature | Reason |
|---------|--------|
| **SDI integration** for Italy | Complex, only if Italian market significant |
| **UK MTD compliance** | Post-2029 |
| **ViDA cross-border e-invoicing** | Mandatory by 2030 |
| **Automated VAT return data** export | Feeds into accounting tools |
| **Double taxation treaty lookup** | Withholding tax optimization |
| **Multi-language contract builder** (all EU languages) | Scale feature |

### What Hour Should NOT Build

- **Accounting system** — Don't try to be Holded/Xero. Generate invoices, export structured data
- **VAT filing** — Let Avalara/Taxually/accountants handle this. Provide the data
- **E-invoicing network operator** — Use middleware (Storecove, Basware) for Peppol/SDI
- **Tax advisor** — Show rates and calculations, always disclaim "consult your accountant"

---

## Appendix: Key Terminology

| Term | Meaning |
|------|---------|
| **NIF** | Número de Identificación Fiscal (Spanish tax ID) |
| **CIF** | Old term for company tax ID in Spain, now just NIF for legal entities |
| **VIES** | VAT Information Exchange System — validates EU VAT numbers |
| **OSS** | One-Stop Shop — simplified VAT reporting for cross-border B2C |
| **Reverse charge** | Buyer self-assesses VAT instead of seller charging it |
| **Factur-X** | Franco-German hybrid invoice format (PDF + XML) |
| **UBL** | Universal Business Language — XML invoice standard |
| **XRechnung** | German e-invoice standard (EN 16931 profile) |
| **ZUGFeRD** | German hybrid invoice format (PDF/A-3 + XML) |
| **Peppol** | Pan-European Public Procurement Online — e-invoicing network |
| **SDI** | Sistema di Interscambio — Italian e-invoice exchange platform |
| **FatturaPA** | Italian e-invoice XML format |
| **ATCUD** | Portuguese unique document identifier code |
| **SAF-T** | Standard Audit File for Tax — structured accounting export |
| **PDP** | Plateforme de Dématérialisation Partenaire (France) |
| **ViDA** | VAT in the Digital Age — EU-wide e-invoicing framework |
| **EN 16931** | European standard for electronic invoicing |
| **SINK** | Swedish withholding tax for non-resident artists |
