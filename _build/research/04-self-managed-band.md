> Hour — user research
> Profile 04: Self-managed band (DIY, no manager / no label / no booker)
> Status: draft v1 · 2026-04-19

# Profile 04 — Self-managed band

The band that does everything itself. The archetypal DIY outfit in the indie, punk, hardcore, experimental, or lo-fi scene, and its cousins — the self-releasing jazz quartet, the improv-noise duo that books its own European loop, the lo-fi songwriter with a rhythm section. Three to six members. No manager. No booking agent. No label. No PR. No distributor beyond whichever aggregator pushes their Bandcamp to Spotify.

This profile is deliberately set apart from Profile 02 (indie band with some infrastructure). Profile 02 has a manager, a booker, or a small label in the picture — somebody, somewhere, is paid to do part of the work. Profile 04 has none of that. The only labour is the band's own labour, and the only money is what comes through the door.

The central claim of this research is that the DIY band is not a "smaller" version of a professional band. It is a different animal, with different values, different workflows, and different failure modes. Software designed for the professional end of the market does not scale down to it — not because the features are wrong, but because the posture is wrong.

---

## 1. What they juggle

One band, always. Sometimes a side project (a solo thing, a duo, a second band with one overlapping member). The unit of time is the album cycle: the album-in-progress becomes the album-out, and the album-out becomes the next album-in-progress. A full cycle typically runs one to three years, occasionally longer when the band is part-time.

Inside that cycle, the band juggles:

- **Creative work.** Writing, rehearsing, recording. The "local de ensayo" — a shared rehearsal room paid by the month, sometimes in a polígono on the edge of town, sometimes in a shared building with six other bands.
- **Fan-facing communication.** Instagram (primary), TikTok (increasingly), Spotify artist profile, Bandcamp, a Linktree, maybe a Mailchimp list. The Reddit thread tone across r/WeAreTheMusicMakers is that keeping all of these alive is already half a job, and most bands let half of them go dormant.
- **Contact book.** Dozens to low hundreds of contacts, accumulated over years of DIY touring — promoters, venue bookers, other bands, sound engineers met on the road, the friend in Berlin with a spare room. Almost never in a database. Usually scattered across Gmail, WhatsApp, Instagram DMs, and memory.
- **The day-job reality.** Sector surveys consistently report that over 40% of musicians earn less than \$10,000/year from music ([Sonicbids — 15 Side Jobs](https://blog.sonicbids.com/15-unexpectedly-awesome-side-jobs-for-working-musicians)). The most common Profile 04 configuration in Spain is: 3-6 members, each with a day job or freelance income (teaching, bar work, a half-time office job, freelance graphic design), and the band as a deliberately non-breadwinning activity that is nonetheless taken seriously. The day job is the reason tours can only happen in summer or on long weekends.

**Design consequence.** The software cannot assume the band is the user's full-time work. Time-on-task is measured in stolen evenings. Any feature that requires more than ten minutes a week to maintain will die.

---

## 2. Annual cycle

The week in a DIY band is bimodal: weekdays are work / rehearsal / admin, weekends are gigs. The "rehearsal night" is a near-sacred fixed slot — Tuesday or Thursday, 20:00-23:00, in the local de ensayo — and the group chat lights up with "quién viene?" two hours before.

The year has a predictable rhythm:

- **Winter (Jan-Mar).** Festival application season. This is when the band submits to summer festivals, Monkey Week, Día de la Música Independiente, SON Estrella Galicia circuit, smaller regional showcases ([Monkey Week](https://monkeyweek.org/en/que-es-monkey-week/) hosts over 160 concerts and is the primary showcase meeting point for independent music in Spain). It is also when the "we should do a tour this summer" conversation starts on WhatsApp.
- **Spring (Apr-Jun).** Booking the summer tour. This is where most of the DIY work concentrates — cold emails, calls back to old promoters, "hey we're gonna be in your area" messages. Many bands also try to drop a single here for summer algorithm lift.
- **Summer (Jul-Aug).** The tour itself. Constrained by day-job windows: most Profile 04 tours are 5-14 days, clustered around somebody's summer holiday. Festivals fall in here. Fees are higher, audiences larger.
- **Autumn (Sep-Nov).** Recording, album release, release shows. A handful of regional gigs on weekends.
- **December.** Dead. Nobody books shows. The band rests. The group chat goes quiet.

Album cycles stretch across 1-3 of these yearly rhythms. The "we should record" conversation may last six months before the band blocks out the studio time.

The Creative Independent guide to booking a DIY tour explicitly recommends building around an "anchor gig" — a higher-paying show or festival that makes the rest of the routing economically viable ([The Creative Independent](https://thecreativeindependent.com/tips/how-to-book-a-diy-tour/)). This is a key pattern: DIY tours are built outward from one or two confirmed dates, not top-down from an ideal route.

**Design consequence.** Hour must model the "anchor-first, fill-in-after" planning pattern. A routing tool that demands a complete itinerary up front will not match how these bands actually work.

---

## 3. Difusión / booking

This is the single most time-consuming activity in the life of a DIY band. It is also the area with the highest emotional cost: cold emailing promoters means repeated silence or rejection from people the band admires.

### The circuit

The universe of venues a Profile 04 band can play is a specific subset:

- **DIY and autogestionado venues.** In Spain this means the network of centros sociales okupados autogestionados (CSOAs) — Can Vies, Can Batlló, Ateneu Popular de Salt, Ateneu Rosa de Foc, and the wider constellation mapped at [radar.squat.net](https://radar.squat.net/en/events/country/XC). In Catalonia these are often called **casals** or **cans** ([Actipedia — CSOAs in Spain](https://www.actipedia.org/project/centros-sociales-okupados-autogestionados-csoas-spain-abandoned-houses-activist-enclaves)). In the Basque country, **gaztetxes**. These spaces host bands on a donation or low-fee basis, usually pay in cash, and function on mutual-aid principles.
- **Small commercial venues.** Pub back rooms, jazz basement clubs, 50-200 capacity rooms. In Barcelona: Heliogàbal, Marula Café, La Nau, Sidecar, the smaller nights at Apolo's La (2) and La (3) ([Sala Apolo](https://www.sala-apolo.com/en/about)). In the Catalan terminology, these are **bars musicals**, **sales de concert petites**, or simply **pubs**.
- **DIY festivals.** K-Town in Copenhagen, AMFest, Primavera Pro showcases, Tanned Tin, a long tail of regional micro-festivals.
- **Self-promoted shows.** The band rents a room, handles promotion, keeps the door. Common when touring in new cities where no promoter has responded.

### The workflow

1. **Research.** Other bands' tour posters, Instagram check-ins, Indie on the Move ([indieonthemove.com](https://www.indieonthemove.com/home)) for US dates, the band's own past tour routing. No consolidated European database exists at this scale.
2. **Cold email.** Short, specific, with links (never attachments). The consensus across booking guides is six sentences or fewer, subject line formatted `[Artist Name] — [Date Range] — [City]` with genre in parentheses ([Gigwell](https://www.gigwell.com/blog/how-to-book-shows), [Flypaper](https://flypaper.soundfly.com/hustle/how-to-write-the-perfect-cold-booking-email/), [Indie Music Academy](https://www.indiemusicacademy.com/blog/how-to-book-a-tour)).
3. **Silence.** Most emails go unanswered. Gigmit and multiple DIY guides converge on a reply rate in the single digits.
4. **Follow-up.** One polite follow-up after 7-10 days. Then stop.
5. **Referral chain.** The highest-converting path is band-to-band: "we played at X, they said you might like us." Once a band has played a city, the next booking there is 5-10x easier.

The Vice / NOISEY piece on booking a European tour as a "broke American with no industry contacts" ([Vice](https://www.vice.com/en/article/how-to-book-a-european-tour-as-a-broke-american-with-no-money-or-industry-contacts/)) is one of the most-circulated DIY touring essays and captures the tone: the work is email, the currency is favours, the return is mostly non-monetary.

### Submission platforms

Submithub and Groover are present but ambivalent. They are primarily **music-to-curator** tools (playlist placements, blog coverage), not **band-to-promoter** tools. Groover has 7-day guaranteed feedback at €2/submission; Submithub uses a credit system that can escalate ([Musosoup comparison](https://musosoup.com/blog/groover-vs-submithub), [Playlisthub](https://playlisthub.io/blog/groover-vs-submithub-which-platform-offers-the-best-music-promotion-for-artists-in-2025/)). DIY bands use them for PR, not booking. For booking, the only working channel remains direct email and personal relationships.

**Design consequence.** The booking model Hour ships with must assume very low conversion (single-digit percent) and very high relational value per confirmed date. The data model should make it trivial to capture "X recommended us to Y" — the referral chain is the actual asset.

---

## 4. Production

In a Profile 04 band, the band **is** the production. There is no production manager, no tour manager, no sound engineer. Roles are covered by body:

- **Driver.** Usually whoever has a licence and tolerates long drives — often the bassist. On longer tours with van rental, the two or three members with licences rotate.
- **Merch.** Often handled by a non-member — a partner, a sibling, a fan who comes on the tour. Paid in symbolic per diem and free merch. The "merch person" is a distinct social role in DIY tours and is usually the same person every tour.
- **Sound.** Venue-provided 95% of the time at this scale. The band arrives, adapts to whatever backline and PA are there. The stage plot is a hand-drawn PDF with input channels and a rough stage map — good enough for a venue sound tech to read in five minutes.
- **Backline.** Cheap, minimalist, borrowed. Amps borrowed from the local support band. Drum kit provided by the venue or the other band on the bill. Guitars travel.
- **Van and logistics.** Rental: Bsuch, Europcar, Roadsurfer, Europcar's local competitors in Spain (Centauro, Goldcar). A 9-seater Transit or similar, €80-150/day. Fuel split across the band. Some bands buy an old van and maintain it collectively — this is rarer and almost always ends in mechanical regret.

### Sleeping and eating

The DIY touring band does not stay in hotels. The economics do not work. The two patterns:

- **Crash spaces.** Friend-of-a-friend couches, other bands' flats, promoters' spare rooms. The "can I come sleep at your drummer's flat" network. The [DIY Conspiracy](https://diyconspiracy.net/) hardcore scene mapping and multiple tour diaries (e.g. [Greg Rekus Europe 2018](https://idioteq.com/diy-tour-diary-greg-rekus-europe-2018/)) document this as standard.
- **Hostels.** When crash spaces fail, cheap hostels. €20-40/person/night. On 5-day tours this still adds €100-200/person.

Per diems are symbolic: €10-30/person/day, just enough for a cheap meal and a coffee. On DIY tours with a venue-provided meal ("catering"), per diems often shrink further. The band eats supermarket sandwiches in the van for lunch, venue food for dinner.

**Design consequence.** The production layer Hour needs is thin — a stage plot upload, a crash-space contact, venue technical notes. Not the full production hierarchy a theatre company needs.

---

## 5. Archive and materials

Minimal but curated:

- **Bandcamp page.** The source of truth for releases. Direct sales, full track streaming, artist-owned. DIY bands prioritise Bandcamp over Spotify for identity reasons even though Spotify delivers more passive listeners.
- **Linktree or equivalent.** One URL that routes to everything — Bandcamp, Spotify, Instagram, a booking email, maybe a Patreon.
- **A small set of photos.** 3-5 live shots, 1-2 promo shots. Shot once every 1-2 years by a friend who does photography. Re-used for two years.
- **EPK / one-sheet.** Often just a Google Doc or a single PDF with bio (ES and EN), photo links, audio links, a live video, contact email. The DIY guide at [Indie Berlin](https://www.indie.berlin/your-epk-the-full-package-that-actually-opens-doors/) and [CDBaby DIY Musician](https://diymusician.cdbaby.com/music-promotion/electronic-press-kits-epks/) both confirm the one-page format as the DIY standard. Bandzoogle/ReverbNation paid EPK tools exist but uptake among Profile 04 bands is low.
- **Rider.** A single page, more a wishlist than a spec. "6 beers, water, a green room if possible, a hot meal for 4." Often ignored by DIY venues ("we ran out of the beer you asked for") — which is tolerated as part of the ethic.
- **Stage plot.** Hand-drawn, annotated PDF. Sometimes a photo of a whiteboard.

The archive lives in the bandleader's Google Drive or a shared Dropbox. The version control problem is acute: "which version of the bio is current?" is often answered by "whichever one the drummer emailed last." Multiple members edit the same Google Doc and overwrite each other.

**Design consequence.** Hour's materials layer must be dead simple: one canonical version per asset, clear "latest" status, link-sharable without account creation on the receiving end.

---

## 6. Money

### Fees

- **DIY shows.** €100-600, often paid in cash after the show. Door deal common (50/50, 70/30, or 100% of door after venue costs).
- **Small festivals.** €500-2000, sometimes with travel covered, sometimes not.
- **Self-promoted shows.** Whatever comes through the door, minus venue rental and sound. Can be profitable in home cities, rarely on tour.
- **Bandcamp and streaming.** Non-trivial only for the top decile. For most Profile 04 bands, streaming income is €10-50/month; Bandcamp is €50-500/month spiking on release weeks.

### Splitting

At the end of the tour, everyone sits in the van or the last venue's back room and splits the envelope. Fuel, rental, food come off the top; the rest divides equally. Receipts live in a shoebox or a zippered pouch in the van until somebody does a pass at them post-tour. One member — the "quasi-accountant," usually the most organised — handles the bookkeeping. This role is almost always uncompensated and a source of quiet resentment.

The concept of the "hucha de grupo" or "caja común" (band fund) is widespread but informal: a shared bank account, a PayPal, or simply a cash tin, where gig money accumulates to pay for the next EP, merch run, or van rental. No structured search result surfaced for this term — the practice is widely referenced in Spanish musician forums but not formalised in any guide I located.

### Tax — the friction

- **Spain / autónomo.** The legal path to invoicing a gig is to be registered autónomo ([Sympathy for the Lawyer](https://sympathyforthelawyer.com/blog/facturar-conciertos-actuaciones-artisticas-iva-alta-autonomos-irpf/), [Musicing](https://musicing.es/blog/la-guia-definitiva-de-fiscalidad-para-musicos-en-espana/)). Invoices carry 10% reduced IVA (since 2019) and 15% IRPF retention (7% first two years). The "artista ocasional" figure allows occasional invoices without autónomo registration for non-habitual activity, but the definition of "habitual" is fuzzy and many DIY musicians operate in a grey zone. The Estatuto del Artista (2022) added specific compatibility rules for retired artists and reduced cotizaciones thresholds — not yet well understood at the DIY level.
- **Germany / KSK.** Foreign artists performing temporarily in Germany are not insured through the Künstlersozialkasse, but the Künstlersozialabgabe (KSA) contribution is still owed by the organiser ([touring-artists.info](https://www.touring-artists.info/en/social-security/users-contribution-social-security-contributions-for-artists), [kulturspace](https://www.kulturspace.com/ksk)). For self-booked shows where a bar is the organiser, the bar is liable. Most DIY bars do not know this, do not file, and bands generally ignore it at their own risk.
- **France / régime intermittent.** Not available to non-residents for self-booked work ([France Travail](https://www.francetravail.fr/spectacle/spectacle--intermittents/les-regles-applicables-en-matier.html), [Orfeo](https://orfeo.pro/blog/embaucher-intermittent-spectacle-etranger-loi)). A Spanish band playing France needs an A1 certificate (social security portability), and if the French venue declares the fee, a retenue à la source (withholding tax for non-residents) applies. In practice, DIY bookings in France below a certain threshold are paid in cash and unreported.
- **VAT cross-border.** Technically, services rendered by a Spanish band to a German venue should be invoiced with reverse-charge VAT. At the DIY scale, this is almost universally ignored. Occasionally a tax audit at the venue side surfaces the problem.
- **SGAE.** The obligation to declare setlists to SGAE (or to opt out, via the "gestión independiente" route) is broadly skipped or forgotten at the DIY level. Bands that are not registered as SGAE members cannot collect in any case.

### Payment terms

Cash on the night or 30-day bank transfer. Occasionally 60 days for festivals with a bureaucratic layer. Invoices are often issued retroactively, days or weeks after the show, when the band realises the venue needs one for its own accounting.

**Design consequence.** Hour should make it possible to track cash payments without requiring them to fit a formal invoice model — because often there is no invoice. A gig can be "paid in cash, €250, no invoice" and that has to be a valid state.

---

## 7. Tools today and why they fail

The default stack:

- **WhatsApp group.** The source of truth for everything — rehearsal scheduling, decisions, creative arguments, tour logistics, the "who's driving tomorrow" question. WhatsApp now has Polls and Events features which more bands are using for rehearsal/gig coordination ([WhatsApp Help Center](https://faq.whatsapp.com/3313983622238973/)). The problem with WhatsApp as source of truth: nothing is searchable after 3 months, decisions get buried, and new members have no history.
- **Google Drive.** Tour routing spreadsheets, budget spreadsheets, lyric docs, contract PDFs, photo archives. The [Audiofemme — Check The Spreadsheet](https://www.audiofemme.com/check-the-spreadsheet-getting-organized/) piece lays out the canonical booking-spreadsheet column structure: Date / City / Outreach & Contacts / Venue / Bands / Door Deal or Guarantee / Accommodation / Notes / Confirmed — this is close to universal among DIY bands who bother with a spreadsheet at all.
- **Gmail.** The split matters. Two patterns:
  - **Shared band Gmail** (e.g. `bandname@gmail.com`). One password, everyone in the band has it. Clean, but means the bandleader still checks it alone because nobody else bothers.
  - **Bandleader's personal Gmail.** Everything goes through one person. They become the single point of failure. If they are on holiday, the band is offline.
  This split is load-bearing: the choice signals how seriously the band is operating as a collective versus as a de-facto frontperson project.
- **Bandcamp.** For releases, merch, mailing list. The mailing list function is underused but present.
- **Instagram.** Content, DMs from promoters and fans.
- **Notion / Airtable.** Some try. [Von Bieker's blog post](https://www.vonbieker.com/2018/10/26/how-notion-so-keeps-my-music-career-on-track/) is a widely-cited example of a musician moving their booking plans to Notion. The [Notion Band Management Workspace](https://www.notion.com/templates/band-management-workspace) template exists. Uptake is low and abandonment is common. Reason: the learning curve is too steep for a shared-labour context where no single member has time to become "the Notion person."

### Why everything fails

Across Reddit threads, DIY guides, and interviews, the same patterns recur:

1. **No member has time to learn.** The band is the third priority after day job and personal life. A tool that requires setup investment dies before it is used.
2. **No member wants to own the software.** Ownership means responsibility. The "quasi-accountant" already owns too much.
3. **The software is built for companies.** Most music business tools (Giggio, MyBizzHive, Gigwell, MusoCRM) position themselves as CRM-for-musicians. The language is "pipeline," "leads," "deals," "revenue." The DIY band hears this and recoils.
4. **Tool fragmentation fails to collapse.** Each tool (WhatsApp + Drive + Gmail + Bandcamp + Notion attempt) handles one thing. Integration is always manual copy-paste. The manual copy-paste is where the data rots.

**Design consequence.** Hour's adoption barrier has to be near-zero. If the first session does not save time immediately, the band will never open the app again.

---

## 8. Collaboration patterns

Two archetypes, both well-documented:

- **Bandemocracy.** Every decision by consensus. Works for creative decisions. Breaks on operational ones. The [Slate — Bandleader Management Styles](https://slate.com/human-interest/2018/08/bandleader-management-styles-which-approach-works-best-for-bands.html) and [Reverb News — Can A Band Survive As A Democracy?](https://reverb.com/news/can-a-band-survive-as-a-democracy) pieces both converge on: total democracies are slow and frequently unsatisfying, someone has to steer.
- **De-facto bandleader.** One member ends up doing 70%+ of admin (booking, budgeting, communications) without formal acknowledgement. This member quietly builds resentment. The [Flypaper — 10 Essential Qualities of Band Leadership](https://flypaper.soundfly.com/tips/10-essential-qualities-of-great-band-leadership/) piece names this as "the tyranny of structurelessness" — the pretence of flat structure hiding a real hierarchy.

The rotation-of-responsibilities attempt ("you handle booking this tour, I'll handle the next one") is common and almost always fails. Different members have different standards. The stakes of a missed email are high. After one or two blown handoffs, the work returns to the de-facto leader.

### External collaborators

Always ad-hoc, always by DM:

- **Designer for album art.** Usually a friend or a friend of a friend. Paid in symbolic fee + records + beer.
- **Mixing / mastering engineer.** Paid per track, €100-400 depending on scene. Often the same person across multiple releases.
- **Photographer / videographer.** Same pattern. Paid symbolically, credited generously.
- **Fellow bands.** Mutual recommendation is the core currency. "We'll get you on this bill if you get us on that one." Never formalised.

**Design consequence.** The roles model in Hour must support fuzzy, part-time, unpaid collaborator slots — not just employee-like members. And it must make rotation of admin responsibilities *visible* (who is actually doing the work this month?) without feeling like a surveillance tool.

---

## 9. Real vocabulary

A working glossary in the languages these bands actually use. Translation is omitted where translation would distort.

| Term | Lang | Meaning / context |
|---|---|---|
| **bolo** | ES | gig, informal. The default word. "Tenemos bolo en Zaragoza." |
| **toque** | ES | gig, in some regions and genres (more in rock/metal/folk). |
| **concierto** | ES | formal word; used in press and contracts, rarely in band talk. |
| **gig** | EN | universal loan into all scenes. |
| **date** | EN | a confirmed booking on a tour. "We've got 8 dates." |
| **show** | EN/ES | interchangeable with gig, slightly more formal. |
| **ensayo** | ES | rehearsal. |
| **assaig** | CA | rehearsal (Catalan). |
| **local de ensayo / local d'assaig** | ES / CA | rehearsal room, usually rented. |
| **hucha de grupo** | ES | the band fund. Informal. |
| **caja común** | ES | the common pool (money). |
| **merch** | EN/ES | universal. Merchandise — shirts, vinyl, tote bags. |
| **reparto** | ES | the split (of money at the end of the night/tour). |
| **cachet** | ES | fee, guarantee. Loan from French *cachet*. |
| **guarantee** | EN | the minimum the band gets paid regardless of door. |
| **caché** | ES | same as cachet, occasional alternative spelling. |
| **sala** | ES | the venue (music room). |
| **sala pequeña** | ES | small venue, typically < 200 cap. |
| **sala de concerts petita** | CA | same (Catalan). |
| **bar musical** | CA | a bar that programmes live music — distinct from a club. |
| **pub** | CA/ES | a small live-music bar, often the smallest paid venue tier. |
| **bolillo** | ES | (regional slang) a small, low-stakes gig. |
| **gira-relámpago** | ES | mini-tour, a few days, quickly put together. Lit. "lightning tour." |
| **caseta** | ES | local fair/fiestas stage. Summer work for regional bands. |
| **dormir en casa de** | ES | "sleeping at X's place." The entire crash-space ecosystem. |
| **squat** | EN | universal in the DIY scene. |
| **okupa** | ES | squatter / squat. From *ocupar*. |
| **CSOA** | ES | Centro Social Okupado Autogestionado. |
| **autogestionado / autogestionat** | ES / CA | self-managed, self-organised. Core DIY value word. |
| **casal / can** | CA | Catalan equivalent of CSOA. |
| **gaztetxe** | EU | Basque equivalent. |
| **ateneu / ateneo** | CA / ES | cultural centre, often with musical programming. |
| **polígono** | ES | industrial estate, where cheap rehearsal rooms live. |
| **kidnap the venue** | EN | DIY slang — when the band effectively runs the show themselves (promotion, door, PA). |
| **self-promoted** | EN | band promotes its own show. Keeps all door receipts. |
| **donation basis** | EN | DIY show where entry is by donation, no fixed price. |
| **rider** | EN/ES/FR | universal. Hospitality and technical requirements. |
| **stage plot** | EN/ES | universal. The diagram of inputs and stage positions. |
| **backline** | EN | the heavy gear (amps, drums). Universal. |
| **load-in / load-out** | EN | universal in tour talk. |

The Catalan DIY vocabulary maps closely to the Spanish but with distinct venue categories: `sala de concerts petita` is the legal/institutional term (used by the [Associació de Sales de Concerts de Catalunya](https://salesdecatalunya.cat/)), `bar musical` is the everyday term, and `pub` covers the smallest tier.

---

## 10. Friction stories

Anecdotal — drawn from DIY tour diaries, Reddit threads, and forum posts. Single-source or pattern-level. The specific anecdotes below are illustrative composites of patterns widely reported.

- **The holiday failure.** The only member holding the promoter's email address goes on holiday. The promoter follows up with a logistics question. Nobody answers for 10 days. The promoter gives the slot away.
- **The rider that was ignored.** The rider lists 6 beers, water, and a hot meal. The DIY venue "ran out of beer" and offered cold pizza. Everybody laughs about it later but the drummer is still hungry at load-out.
- **The cash that disappeared.** €300 in cash, paid on the night, stuffed into the van glove compartment. Two days later nobody can find it. It turns up three weeks after the tour ends, in a merch box.
- **The invoice that nobody could issue.** A regional festival required an invoice for €800. None of the band members were registered autónomo. The festival could not pay without a fiscally valid document. The band scrambled and ended up invoicing through a friend's cooperative, losing ~20% to management fee.
- **The dormant email list.** 400 addresses collected over five years of shows. Last newsletter sent three years ago. Everyone on the list has forgotten the band. The list is technically an asset and practically a source of guilt.
- **The buried DM.** A European festival programmer DMs the band's Instagram: "hey, interested in booking you for 2026, can you send a rate?" The DM lands between 200 fan messages. Nobody sees it for six weeks. By then, the programmer has moved on.
- **The split that got tense.** After a ten-day tour, fuel and rental take €2,400 off the top. The band expected a €300/person split, actually gets €180/person. Two members are fine, one is angry because they took unpaid days off work to drive.
- **The contact that died with Gmail.** The bandleader's personal Gmail is the only place a key promoter's direct contact is stored. The bandleader loses the phone, forgets the password. The contact is effectively gone until the next time they play the same city and ask around.

These stories are the core pitch surface for Hour. Each one is avoidable if the band has a single, shared, searchable place where contacts, decisions, and money live.

---

## 11. What they do NOT want software to do

This is the design constraint that distinguishes Profile 04 from all other profiles. DIY bands resist software on identity grounds. The ethic is explicit and load-bearing.

They do not want to:

- **Feel like a corporation.** No "dashboard" language. No "pipeline." No "lead." No "client." No KPIs. No ROI.
- **Become a "business."** The band is explicitly not a business, even when money flows through it. Calling it a business violates the frame the band built around itself.
- **Look like a CRM.** CRM is the most frequently-named anti-pattern across DIY musician forums. CRMs treat contacts as commodities to extract value from; the DIY ethic treats contacts as peers in a mutual-aid network. The first move of any Hour design aimed at Profile 04 is to not look like Salesforce, HubSpot, Gigwell, or Giggio ([Giggio](https://www.getgiggio.com/)) — all of which use the explicit "CRM for musicians" framing.
- **Automate relationships.** A templated cold email to 50 promoters is worse than a handwritten one to 10. Automation is read as insincerity.
- **Optimise the scene.** The DIY scene's value proposition is that it is inefficient — that the slowness, the crash-space stays, the borrowed backline, the cash at the door are the point, not a stage to be automated past. Any feature that "optimises" this risks gutting it.
- **Demand completeness.** A CRM expects every field filled. A DIY band leaves most fields empty and the software should not nag.
- **Charge like a business tool.** Profile 04 bands have between €0 and €30/month to spend on software across all members. The free tier has to be genuinely usable.

The positive frame: Hour should read as **a shared notebook with quiet structure**, not a management platform. It should respect the messiness (version conflicts, half-empty fields, undated contacts) rather than punish it. It should reward the values the band already has — DIY, peer-to-peer, trust-based — rather than try to replace them with corporate ones.

**Design consequence.** The language, visual grammar, and defaults of Hour have to pass a "does this smell like a CRM?" sniff test for every surface. If the answer is yes, Profile 04 churns in the first session.

---

## 12. Sector references

Thicker in Reddit / forum / blog than in formal sector publications, as expected. Primary reference pool:

- **Reddit.** r/WeAreTheMusicMakers, r/musicians, r/indieheads, r/punk. The most useful threads are tour-diary AMAs and "how do you track contacts" mega-threads. r/WeAreTheMusicMakers has an active Discord ([Discord invite](https://discord.com/invite/wearethemusicmakers)).
- **Books.**
  - Ari Herstand — *How To Make It in the New Music Business* (3rd ed, [book.aristake.com](https://book.aristake.com/)). The de facto textbook. Adopted by 300+ universities. Practical and DIY-sympathetic.
  - Jesse Cannon & Todd Thomas — *Get More Fans: The DIY Guide to the New Music Business* (10th ed, 2024) ([jessecannon.com/writing](https://www.jessecannon.com/writing)). Strategy-heavy, fan-building-focused.
- **Blogs.**
  - Ari's Take ([aristake.com](https://book.aristake.com/)).
  - CD Baby DIY Musician blog ([diymusician.cdbaby.com](https://diymusician.cdbaby.com/)).
  - The Creative Independent — extensive interviews and how-to guides ([thecreativeindependent.com](https://thecreativeindependent.com/tips/how-to-book-a-diy-tour/)).
  - DIY Conspiracy — the hardcore/punk end, Europe-centred ([diyconspiracy.net](https://diyconspiracy.net/)).
  - IDIOTEQ — tour diaries from DIY bands in Europe ([idioteq.com](https://idioteq.com/)).
  - Flypaper by Soundfly ([flypaper.soundfly.com](https://flypaper.soundfly.com/)).
  - Sonicbids blog ([blog.sonicbids.com](https://blog.sonicbids.com/)).
- **Magazines / archives.**
  - Bandcamp Daily — artist features, often with DIY focus.
  - Tiny Mix Tapes archive — defunct but archive is still a reference point for underground / experimental DIY.
  - Vice / NOISEY — the "Book a European Tour as a Broke American" piece ([Vice](https://www.vice.com/en/article/how-to-book-a-european-tour-as-a-broke-american-with-no-money-or-industry-contacts/)) is widely cited.
- **Spanish / Catalan references.**
  - Sympathy for the Lawyer ([sympathyforthelawyer.com](https://sympathyforthelawyer.com/)) — the most-cited ES-language legal/fiscal reference for musicians.
  - Musicing ([musicing.es](https://musicing.es/)) — fiscal and career guides.
  - Guitarristas.info forums — forum-quality but a real primary source for Spanish DIY musician questions.
  - Monkey Week / SON Estrella Galicia programme ([monkeyweek.org](https://monkeyweek.org/en/que-es-monkey-week/)).
- **Scene-network references.**
  - radar.squat.net — the DIY / autogestionado venue and events network ([radar.squat.net](https://radar.squat.net/)).
  - Indie on the Move (US-focused but referenced in EU DIY planning) ([indieonthemove.com](https://www.indieonthemove.com/home)).
  - K-Town Hardcore Fest Copenhagen ([ktownhardcorefest.org](https://ktownhardcorefest.org/)) — emblematic DIY-fest infrastructure.
- **Institutional (thin but present).**
  - touring-artists.info — the German touring legal/social-security portal ([touring-artists.info](https://www.touring-artists.info/)).
  - France Travail (intermittents, cross-border rules) ([francetravail.fr](https://www.francetravail.fr/spectacle/spectacle--intermittents/les-regles-applicables-en-matier.html)).
  - Circostrada, IETM, On The Move — all referenced in Profiles 01-03 but **thin for Profile 04**. DIY bands are under the radar of European sector support networks.

No solid quantitative data exists on: Profile 04 population size in Europe, average annual Profile 04 tour count, Profile 04 churn (how many DIY bands dissolve per year). These numbers would require primary fieldwork; they are not published.

---

## Sources

- [The Creative Independent — How to book a DIY tour](https://thecreativeindependent.com/tips/how-to-book-a-diy-tour/)
- [DIY Musician (CD Baby) — Musician's guide to touring Europe without a booking agent or label](https://diymusician.cdbaby.com/music-career/musicians-guide-touring-europe-without-booking-agent-label-part-1/)
- [DIY Musician (CD Baby) — How to Book Your Own Tour](https://diymusician.cdbaby.com/music-career/how-to-book-your-own-tour/)
- [Performer Magazine — Tips for Booking Your Own DIY International Tour](https://performermag.com/band-management/booking-gigs-touring/tips-on-booking-your-own-international-tour/)
- [Indie Music Academy — How to Book a Tour in 12 Steps](https://www.indiemusicacademy.com/blog/how-to-book-a-tour)
- [Vice — How to Book a European Tour as a Broke American with No Money or Industry Contacts](https://www.vice.com/en/article/how-to-book-a-european-tour-as-a-broke-american-with-no-money-or-industry-contacts/)
- [Sonicbids blog — How to Book a DIY Tour Like a Pro](https://blog.sonicbids.com/how-to-book-a-diy-tour-like-a-pro)
- [Sonicbids blog — 15 Unexpectedly Awesome Side Jobs for Working Musicians](https://blog.sonicbids.com/15-unexpectedly-awesome-side-jobs-for-working-musicians)
- [Gigwell — How to Book a Show: A Tactical Approach For Pitching Venues](https://www.gigwell.com/blog/how-to-book-shows)
- [Gigmit blog — 10 Cold Email Tips for Bookings](https://blog.gigmit.com/en/10-cold-email-tips-for-bookings/)
- [Flypaper — How to Write the Perfect Cold Booking Email](https://flypaper.soundfly.com/hustle/how-to-write-the-perfect-cold-booking-email/)
- [Flypaper — 10 Essential Qualities of Great Band Leadership](https://flypaper.soundfly.com/tips/10-essential-qualities-of-great-band-leadership/)
- [ReverbNation blog — 4 Ways To Improve DIY Touring For Small Bands](https://blog.reverbnation.com/improve-diy-touring-small-bands/)
- [Reverb News — Can A Band Survive As A Democracy?](https://reverb.com/news/can-a-band-survive-as-a-democracy)
- [Slate — Bandleader Management Styles](https://slate.com/human-interest/2018/08/bandleader-management-styles-which-approach-works-best-for-bands.html)
- [Audiofemme — Check The Spreadsheet: Getting Organized](https://www.audiofemme.com/check-the-spreadsheet-getting-organized/)
- [DIY Conspiracy — Hexis interview](https://diyconspiracy.net/hexis-interview/)
- [DIY Conspiracy — homepage](https://diyconspiracy.net/)
- [IDIOTEQ — DIY tour booking & essentials by Group of Man](https://idioteq.com/diy-tour-booking-essentials-by-group-of-man/)
- [IDIOTEQ — Greg Rekus Europe 2018 tour diary](https://idioteq.com/diy-tour-diary-greg-rekus-europe-2018/)
- [K-Town Hardcore Fest](https://ktownhardcorefest.org/)
- [Ari's Take / book.aristake.com](https://book.aristake.com/)
- [Jesse Cannon — Writing](https://www.jessecannon.com/writing)
- [Jesse Cannon / Todd Thomas — Get More Fans](https://www.amazon.com/Get-More-Fans-Guide-Business/dp/0988561301)
- [Sympathy for the Lawyer — Guía facturar conciertos](https://sympathyforthelawyer.com/blog/facturar-conciertos-actuaciones-artisticas-iva-alta-autonomos-irpf/)
- [Sympathy for the Lawyer — Gestoría para artistas y músicos](https://sympathyforthelawyer.com/blog/gestoria-para-artistas-musicos-derechos-autor-facturacion/)
- [Musicing — Fiscalidad para Músicos en España](https://musicing.es/blog/la-guia-definitiva-de-fiscalidad-para-musicos-en-espana/)
- [Musicing — Facturar concierto sin ser autónomo](https://musicing.es/blog/facturar-concierto-sin-ser-autonomo/)
- [SGAE — Gestión fiscal y abono de tus derechos](https://www.sgae.es/autores-editores/gestion-fiscal-y-abono-de-tus-derechos/)
- [touring-artists.info — Künstlersozialabgabe](https://www.touring-artists.info/en/social-security/users-contribution-social-security-contributions-for-artists)
- [touring-artists.info — KSK](https://www.touring-artists.info/en/social-security/social-insurance-in-germany/artists-social-security-fund-/-ksk)
- [kulturspace — Social insurance for artists (KSK)](https://www.kulturspace.com/ksk)
- [bbk Berlin — Künstlersozialkasse FAQ](https://www.bbk-berlin.de/en/faqs-for-artists/kunstlersozialkasse-ksk)
- [France Travail — Règles mobilité internationale pour les intermittents](https://www.francetravail.fr/spectacle/spectacle--intermittents/les-regles-applicables-en-matier.html)
- [Orfeo — Embaucher un intermittent du spectacle étranger](https://orfeo.pro/blog/embaucher-intermittent-spectacle-etranger-loi)
- [Audiens — La rémunération des artistes étrangers](https://www.audiens.org/articles/la-remuneration-des-artistes-etrangers.html)
- [Actipedia — CSOAs in Spain](https://www.actipedia.org/project/centros-sociales-okupados-autogestionados-csoas-spain-abandoned-houses-activist-enclaves)
- [radar.squat.net — Events in Catalonia](https://radar.squat.net/en/events/country/XC)
- [Squatting Europe Kollective — Madrid squats map](https://maps.squat.net/en/cities/madrid/squats)
- [Wikipedia — Squatting in Spain](https://en.wikipedia.org/wiki/Squatting_in_Spain)
- [Monkey Week SON Estrella Galicia — What is Monkey Week](https://monkeyweek.org/en/que-es-monkey-week/)
- [Sala Apolo — About](https://www.sala-apolo.com/en/about)
- [Musosoup — Groover vs Submithub](https://musosoup.com/blog/groover-vs-submithub)
- [Playlisthub — Groover vs SubmitHub 2025](https://playlisthub.io/blog/groover-vs-submithub-which-platform-offers-the-best-music-promotion-for-artists-in-2025/)
- [indie.berlin — Your EPK](https://www.indie.berlin/your-epk-the-full-package-that-actually-opens-doors/)
- [DIY Musician (CD Baby) — EPKs](https://diymusician.cdbaby.com/music-promotion/electronic-press-kits-epks/)
- [Bandzoogle — Artist EPK Builder](https://bandzoogle.com/features/epk)
- [Notion — Band Management Workspace template](https://www.notion.com/templates/band-management-workspace)
- [Von Bieker — How Notion.so Keeps My Music Career on Track](https://www.vonbieker.com/2018/10/26/how-notion-so-keeps-my-music-career-on-track/)
- [DIY Music Guide — CRM systems for small studios](https://www.diy-music-guide.com/articles/my-free-simple-crm-for-small-studios-and-freelancers-part-2)
- [Getgiggio — Best CRM for Musicians](https://www.getgiggio.com/best-crm-for-musicians.html)
- [WhatsApp Help Center — Events in groups](https://faq.whatsapp.com/3313983622238973/)
- [Indie on the Move](https://www.indieonthemove.com/home)
- [r/WeAreTheMusicMakers Discord](https://discord.com/invite/wearethemusicmakers)
- [Bandhive — What Does It Cost to Go on Tour?](https://bandhive.rocks/what-does-it-cost-to-go-on-tour/)
- [ASCAP — 10 Tips for Saving Money on Your First Tour](https://www.ascap.com/help/career-development/sparkplug-save-money-first-tour)
- [The Crafty Musician — Sample Tour Budgeting Spreadsheet](https://www.thecraftymusician.com/a-sample-tour-budgeting-spreadsheet-free-download/)
- [DIY Musician — Merch Table Basics](https://diymusician.cdbaby.com/music-career/merch-table-basics/)
- [DIY Musician — Tax Information Every Musician Should Know](https://diymusician.cdbaby.com/music-career/tax-information-every-musician-should-know/)
