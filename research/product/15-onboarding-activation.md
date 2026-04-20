# 15. Onboarding & Activation Patterns for Hour

> Sources: case studies and research on Linear, Figma, Notion, Superhuman, Airtable, Calendly, Folk CRM, Attio CRM, plus general B2B SaaS onboarding research. All sourced from public articles and teardowns (April 2026).

---

## 1. Activation Patterns in Successful Vertical SaaS

### Linear — Speed IS the product

- **Aha moment:** Creating an issue in under 3 seconds via the command palette. The product feels faster than everything else.
- **Time to value:** Near-instant. New users can start creating and managing tasks immediately because the interface is self-explanatory.
- **Onboarding flow:** No product tour. No wizard. The product is so opinionated and fast that using it IS the onboarding. Year-long beta phase ensured the product was polished before anyone touched it.
- **Activation metric:** Not publicly disclosed, but growth is product-led through network effects — one person starts, invites their team, team invites other teams.
- **Key insight for Hour:** Speed and polish substitute for onboarding complexity. If the first action feels instant, you've already won. Linear spent $35k total on marketing and reached $400M valuation — the product did the selling.

### Figma — Collaborative aha

- **Aha moment:** Seeing someone else's cursor move in real-time on the same file. Collaboration is visceral and immediate.
- **Time to value:** Under 5 minutes. After signup, Figma drops you into a pre-made design file with annotations showing where to click, drag, and edit.
- **Onboarding flow:** Action-first. Users land in a real working file, not a settings page. Contextual tooltips appear as needed. Team invite is surfaced early but not forced. Launchers let users restart onboarding flows later.
- **Activation metric:** First collaborative edit (implied from patterns).
- **Key insight for Hour:** Drop users into something real, not an empty dashboard. Show the product working before asking for configuration.

### Notion — Templates as onboarding

- **Aha moment:** Seeing a template that matches your use case and realizing you can customize everything.
- **Time to value:** 2-5 minutes if template-driven; much longer on blank canvas.
- **Onboarding flow:** Quick intent quiz at signup ("What will you use Notion for?") -> personalized template selection -> pre-populated workspace. The template IS the onboarding — it teaches the product's "grammar" by example.
- **Activation metric:** Template adoption and first page edit. Setup checklist including "Invite a teammate" raises onboarding completion to 60%, with 40% retention bump at 30 days.
- **Key insight for Hour:** Templates don't just save time — they teach the product. A "Sample Show" template for Hour would simultaneously demonstrate features AND deliver value.

### Superhuman — White-glove that scales

- **Aha moment:** Reaching Inbox Zero for the first time using keyboard shortcuts. Speed creates emotional delight.
- **Time to value:** 30 minutes (the length of the onboarding call), but the value is immediate and dramatic.
- **Onboarding flow:** Originally mandatory 30-minute 1:1 calls. Discovery phase (pain points, workflows) followed by hands-on walkthrough. Required verbal commitment to daily use for 30 days.
- **Activation metric:** 65% full email migration after onboarding call. Human-led onboarding achieved 2x activation vs self-serve. Each specialist generated ~$650K ARR/year.
- **Transition:** Eventually moved to product-led onboarding using full-screen interruptive panels (completion jumped from 30% to 98%). Key feature activation went from 45% to 80% with interruptive design.
- **Key insight for Hour:** For non-technical users, a brief human-led onboarding (even 15 minutes) may dramatically outperform self-serve. This is especially relevant for performing arts users who are skeptical of "yet another tool." A person showing them the tool builds trust that no wizard can.

### Airtable — Bridging mental models

- **Aha moment:** Seeing your spreadsheet data suddenly become a Kanban board, gallery, or calendar with one click. Same data, different view.
- **Time to value:** Under 5 minutes if user imports existing data. Airtable includes an upload step in the onboarding wizard — activation BEFORE orientation.
- **Onboarding flow:** Wizard with data import step early. Pre-populated sample rows. Toggle between views to discover power. Templates for specific use cases.
- **Activation metric:** Data import and first view switch (implied).
- **Key insight for Hour:** If Hour users currently have data in spreadsheets, importing it during onboarding creates instant value. The "same data, different view" moment is powerful for users trapped in flat spreadsheets.

### Calendly — Simple tool, fast activation

- **Aha moment:** Creating your first scheduling link and seeing how simple it is.
- **Time to value:** Under 2 minutes. Immediately after signup: create link, set timezone, connect calendar.
- **Onboarding flow:** Checklist with progress bar. Three steps: account setup, calendar connection, first event creation. No feature tour.
- **Activation metric:** 5 meetings booked within a timeframe.
- **Key insight for Hour:** Simple tools should reach first perceived value in under 2 minutes. The simpler the checklist, the higher the completion rate. Don't over-engineer onboarding for straightforward features.

### Folk CRM — Lightweight and fast

- **Aha moment:** Importing contacts and seeing them organized in a clean, spreadsheet-like interface without configuration.
- **Time to value:** Under 45 minutes for full team onboarding (3 sales reps with zero technical background). Individual setup is minutes.
- **Onboarding flow:** Import contacts, connect email, start. Very little configuration needed. Premium users get a 40-minute onboarding call.
- **Activation metric:** Not publicly disclosed, but designed around contact import + first pipeline creation.
- **Key insight for Hour:** Familiarity wins. Folk's spreadsheet-like interface lowers resistance for users coming from Excel. If Hour can feel "like a spreadsheet but better," the mental model bridge is shorter.

### Attio CRM — Auto-populated magic

- **Aha moment:** Connecting your email and watching Attio automatically build enriched profiles from your communication history.
- **Time to value:** Under 30 minutes for full CRM setup with no technical resources.
- **Onboarding flow:** Connect email + calendar -> Attio auto-populates company and people records -> enriches with public data (job titles, funding, social profiles). The product does the work for you.
- **Activation metric:** Not publicly disclosed, but structured around data connection and first record enrichment.
- **Key insight for Hour:** The more the product can auto-populate from existing data (email contacts, calendar events, Google Drive files), the faster the user sees value. "Connect and watch it work" is more powerful than "fill in your data."

---

## 2. Onboarding Anti-Patterns

### What makes users leave

| Anti-pattern | Why it kills activation | Prevalence |
|---|---|---|
| **Empty dashboard on first login** | Looks broken. User thinks "Did something go wrong?" | Very common |
| **Teaching UI before delivering value** | 9-step tours while activation drops. Users want results, not menus | Very common |
| **Form-first design** | Prioritizing product data needs over user progress feels like homework | Common |
| **Feature dumping** | Revealing all capabilities at once overwhelms newcomers | Common |
| **Administrative gatekeeping** | Requiring team invites, integrations, and preferences before showing value | Common |
| **Excessive personalization surveys** | Long questionnaires before users see any benefit | Moderate |
| **Vague empty states** | Blank screens without guidance, next steps, or examples | Very common |
| **Long checklists** | 4-step tours complete at 40.5%, but 5-step tours drop to 21% | Data-backed |

### The fundamental mismatch

> "Products ask for data while users seek progress. When onboarding functions as a form, it becomes a chore; designed as a success pathway, it builds momentum."

### The 10-minute rule

When users reach the aha moment in under 10 minutes, activation rates are dramatically higher. Beyond 14 days to realize value, churn risk rises fast.

---

## 3. Performing Arts Specific Considerations

### Who these users are

- **Not office workers.** Theater directors, dancers, musicians, production managers, tour technicians. They think in shows, seasons, and tours — not projects and sprints.
- **Phone-first in context.** They may discover Hour at a performing arts fair (Fira Mediterrania, BIME, MIL), try it on their phone between meetings, or test it backstage.
- **Skeptical by default.** They've seen tools come and go. They use Excel + WhatsApp + Google Drive because it works "well enough." The bar for switching is: "Does this save me real time THIS WEEK?"
- **Trust over features.** A recommendation from a fellow company director matters more than any feature list. The tool needs to feel like it was made BY someone in their world, not by a generic SaaS company.

### The switching cost is emotional, not technical

The data in their spreadsheets is simple (contacts, dates, amounts). Migration is trivial technically. But their spreadsheet is THEIRS — they built it, they know where everything is, it has years of history. Switching means admitting the old system wasn't enough, learning something new under time pressure, and risking looking incompetent in front of their team.

**Implication:** Hour can't just be better. It has to feel safe. "You can import your spreadsheet and keep working the way you already do, but now it does more" is a stronger pitch than "forget everything and learn our system."

### Context of use

- Checking the app between rehearsals (5-minute windows)
- Planning a tour while traveling (trains, airports)
- Preparing an invoice after a show (late at night, tired)
- Sharing a tech rider with a venue (needs to be instant, professional)

The tool must work in fragmented, low-energy moments — not just focused desk sessions.

---

## 4. Template vs Blank Canvas

### The research is clear: templates win

- Canva: templates convert 75% of first sessions into creations vs 40% without.
- Notion: template-driven onboarding reduces time-to-value dramatically and teaches the product's grammar by example.
- Airtable: pre-populated sample rows + view toggles let users "see the future of their use case" before committing.

### When templates work best

- Users are new to the product category (Hour's users have never used a performing arts management tool)
- The product has multiple features that aren't obvious from a blank screen
- The user's mental model needs bridging (spreadsheet -> relational tool)
- Users are short on time and need to see value fast

### When blank canvas works

- Power users who know exactly what they want
- Products so simple they don't need examples (like a notes app)
- When templates might constrain or mislead

### For Hour specifically

Templates are the right approach, but they need to be:
- **Recognizable:** A "Sample Tour" with 5 shows, venues, contacts, and a budget that looks like real performing arts data
- **Deletable:** One click to clear sample data and start fresh
- **Educational:** Each sample element subtly teaches a feature (the venue contact shows how contacts work, the show date shows how the calendar works, the budget line shows how finances work)
- **Not overwhelming:** One sample project, not five. One show with a few elements, not a full season.

---

## 5. The "Invite Your Team" Moment

### Research findings

- Users who invite others early have significantly higher activation and retention rates.
- Notion's "invite a teammate" checklist item raises onboarding completion to 60% with a 40% retention bump at 30 days.
- BUT: asking too early adds friction and feels presumptuous before the user has experienced value.

### The right timing

Best practice: **ask intent at signup, defer invitation until after first value moment.**

1. During signup, ask: "Will you use Hour alone or with a team?" (This is segmentation, not friction)
2. Let the solo user explore and reach their aha moment first
3. Surface "invite your team" AFTER the user has created or interacted with something meaningful
4. For team-intent users, make invitation the natural next step after first value

### For Hour specifically

The performing arts sector has a wide range:
- **Solo artist** — may never invite anyone. The tool must be fully valuable solo.
- **Small company (3-8 people)** — the director tries it, then invites the production manager and maybe the technician. Team invitation happens after the director is convinced.
- **Mid-size company (10-20 people)** — the admin/production manager evaluates, then rolls out to the team. Needs a "team setup" that doesn't require everyone to onboard individually.

**Recommendation:** Make Hour fully functional for a single user. Surface team invitation as an optional step after the first meaningful action (e.g., after creating a show or importing data), not as a required onboarding step.

---

## 6. Recommendations for Hour

### 6.1 The Aha Moment (first 5 minutes)

The aha moment for Hour should be: **"I just created a show with venue, dates, and contacts in 2 minutes — and it looks like a real professional tool, not a spreadsheet."**

This works because:
- It's the core action (everything in performing arts revolves around shows/gigs)
- It produces a tangible, visible result (not abstract setup)
- It demonstrates the upgrade from spreadsheets (relational data, professional presentation)
- It can happen in under 5 minutes
- It creates something the user can immediately share with a colleague

The secondary aha (minutes 5-15): **"Wait, it also tracks the budget / generates a tech rider / shows my tour on a map."** The user discovers that the show they just created connects to everything else.

### 6.2 Recommended Onboarding Flow

**Step 0: Before signup**
- Landing page shows a real-looking screenshot or interactive demo with performing arts data. The user should understand what they're getting before creating an account.

**Step 1: Signup (30 seconds)**
- Email + password (or Google SSO). No company name, no role selection, no survey.
- One question max: "What best describes you?" with 3-4 options (Company director / Production manager / Artist / Technician). This personalizes the experience without feeling like a form.

**Step 2: The magic moment (60 seconds)**
- User lands in a workspace with a **sample show** already created — "Ombra Tour 2026" with:
  - 3 venues with dates (Barcelona, Madrid, Sevilla)
  - 2 contacts (a venue programmer, a technician)
  - A simple budget (fee, travel, accommodation)
  - A status (confirmed, pending, cancelled)
- A small, dismissible banner: "This is sample data. Explore it, then create your own show — or import your spreadsheet."
- No product tour. No tooltips unless the user hovers.

**Step 3: First real action (2-3 minutes)**
- Prompt (not forced): "Create your first show" with a simple form: show name, one date, one venue.
- OR: "Import from spreadsheet" with a drag-and-drop CSV upload.
- The moment they create a show, the sample data can be auto-archived or dismissed.

**Step 4: Discovery (3-10 minutes, self-paced)**
- As the user interacts with their show, contextual hints appear:
  - "Add a contact to this venue" (when they click a venue)
  - "Track your budget" (when they open show details)
  - "See your shows on a calendar" (sidebar hint)
- No feature tour. Discovery through use.

**Step 5: Team invitation (optional, after first value)**
- After creating their first show: "Want to share this with your team?" with a simple email invite field.
- Skippable. Solo users never see this as a blocker.

**Step 6: Progressive depth (days 1-14)**
- Email sequence (light, 3-4 emails over 2 weeks):
  - Day 1: "Your first show is set up. Here's what else Hour can do." (one feature highlight)
  - Day 3: "Import your contacts from a spreadsheet" (if they haven't)
  - Day 7: "See how [real company name] uses Hour for their tours" (social proof)
  - Day 14: "Ready to bring your team?" (if solo)

### 6.3 Recommended Activation Metrics

| Metric | What it measures | Why it predicts retention |
|---|---|---|
| **Show created in first session** | User completed core action | Shows understand the product's purpose |
| **Second show created within 7 days** | User returned and repeated | Habit forming, not just testing |
| **Contact added to a show** | User connected relational data | Understanding the "more than spreadsheet" value |
| **Team member invited within 14 days** | User sees collaborative value | Network effect, much harder to churn |
| **Data imported from spreadsheet** | User committed their real data | Switching cost created, serious intent |

**Primary activation metric (proposed):** A user who creates 2+ shows with at least 1 contact within 14 days.

**Secondary (conversion predictor):** A user who invites at least 1 team member OR imports a spreadsheet within 14 days.

**Measurement cadence:**
- 24-hour activation rate (created first show)
- 7-day activation rate (second show + contact)
- 14-day conversion signal (team invite or import)
- 30-day retention (still logging in)

### 6.4 What to Absolutely Avoid

1. **Empty dashboard on first login.** This is the single biggest killer. A performing arts user who sees an empty screen will close the tab and go back to their spreadsheet. Always show something — sample data, a template, a guided prompt.

2. **Long signup forms.** No company name, no team size, no "how did you hear about us" before they see the product. Every field before the aha moment is a potential exit point.

3. **Feature tours and tooltips on first load.** These users are not reading tooltips. They're trying to understand "is this for me?" in 30 seconds. Let the product answer that question through its content, not its UI chrome.

4. **Forcing team setup before solo value.** Many performing arts users are solo or will be the only one evaluating the tool. If the product requires a team to make sense, you've lost the solo artist and the decision-maker who tries tools alone first.

5. **Generic language and examples.** If the sample data says "Project Alpha" and "Client A," the performing arts user won't see themselves in the tool. Use "Teatre Lliure," "Festival Temporada Alta," "Sound technician." Sector-specific language signals "this was made for you."

6. **Requiring email verification before showing the product.** Let them see the product first, verify later. Verification emails are where momentum goes to die.

7. **Mobile-hostile onboarding.** If a user tries Hour on their phone at a fair and the onboarding doesn't work on mobile, they won't try again on desktop. The first impression is the only impression.

8. **Asking for payment information during trial.** Non-technical creative users are especially sensitive to this. It signals "trap" rather than "try."

### 6.5 Template vs Blank Canvas: Final Recommendation

**Use a template (sample show), but make it feel like a demo, not a commitment.**

Specifically:
- **One sample show, not a full workspace.** "Ombra Tour 2026" with 3 dates, 2 contacts, a budget. Enough to demonstrate features, not enough to overwhelm.
- **Clearly labeled as sample.** A dismissible banner: "This is sample data to show you around." No risk of confusion with real data.
- **One-click removal.** "Clear sample data" button always visible. The user should never feel trapped in someone else's template.
- **Sector-specific content.** Real-sounding venue names, realistic budgets in euros, actual show-related terminology. This is what makes Hour feel like it was built for performing arts, not adapted from generic project management.
- **Transition to real data is frictionless.** "Create your first show" sits next to the sample, not behind a menu. Importing a spreadsheet is one click away. The sample shows what's possible; the user's own data makes it real.

The template serves three purposes simultaneously:
1. **Demonstrates value** — the user sees what Hour looks like in action
2. **Teaches features** — each element in the sample subtly shows a capability
3. **Reduces anxiety** — the user isn't starting from zero in an unfamiliar tool

---

## Sources

- [Superhuman's Onboarding Playbook — First Round Review](https://review.firstround.com/superhuman-onboarding-playbook/)
- [Linear App Case Study — Eleken](https://www.eleken.co/blog-posts/linear-app-case-study)
- [SaaS Onboarding UX Patterns — Del Bueno Studio](https://delbuenostudio.com/saas-onboarding-ux-patterns/)
- [Notion's Lightweight Onboarding — Appcues](https://goodux.appcues.com/blog/notions-lightweight-onboarding)
- [Figma's Animated Onboarding Flow — Appcues](https://goodux.appcues.com/blog/figmas-animated-onboarding-flow)
- [Airtable's Onboarding Wizard — Candu](https://www.candu.ai/blog/airtables-best-wizard-onboarding-flow)
- [How to Identify Your Product's Aha Moment — Whatfix](https://whatfix.com/blog/aha-moment/)
- [Activation Playbook — June.so](https://www.june.so/blog/activation-playbook)
- [How to Measure Onboarding: Advanced Activation Metrics — Aakash Gupta](https://www.news.aakashg.com/p/how-to-measure-onboarding-advanced)
- [User Activation: The #1 Signal — Product School](https://productschool.com/blog/analytics/user-activation)
- [Onboarding Invited Users — Userpilot](https://userpilot.com/blog/onboard-invited-users-saas/)
- [Folk CRM Review — Breakcold](https://www.breakcold.com/blog/folk-crm-review)
- [Attio CRM Review — Hackceleration](https://hackceleration.com/attio-review/)
- [Empty State UX — Eleken](https://www.eleken.co/blog-posts/empty-state-ux)
- [SaaS Onboarding Flows That Convert — SaaSUI](https://www.saasui.design/blog/saas-onboarding-flows-that-actually-convert-2026)
