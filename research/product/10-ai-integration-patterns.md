# AI Integration Patterns in Modern Productivity Tools

Research on how task management, project management, and CRM tools integrate AI — what works, what doesn't, and what Hour should learn from each.

---

## 1. Task & Project Management Tools

### 1.1 Linear — The Gold Standard for Subtle AI

**AI Features:**
- **Triage Intelligence**: Analyzes incoming issues using historical backlog data. Suggests labels, assignees, projects, and flags duplicates. Each suggestion includes a plain-language explanation of the model's reasoning.
- **Auto-apply triage suggestions**: Can be configured at workspace or team level to auto-apply AI suggestions (or keep them as manual approvals).
- **Agent workflows**: AI agents that handle routine triage and routing.
- **Duplicate detection**: Flags potential duplicates and links related issues automatically.

**How AI surfaces:**
Suggestions appear inline alongside issues in the Triage view — never in a chatbot or sidebar. Hovering over a suggestion reveals the reasoning and alternative suggestions. It's contextual, quiet, and right where you're already looking.

**What users love:**
- "Like having a quiet, helpful assistant in the background"
- Fast, non-intrusive — doesn't change your workflow
- Reasoning is transparent (you can see WHY it suggested something)
- Excellent for scanning through hundreds of tickets

**What users hate:**
- Limited to Business/Enterprise plans ($16/user/mo+)
- No external-facing features (it's an internal tool only)

**Pricing:**
AI agents included on all plans (even Free). Triage Intelligence requires Business ($16/user/mo) or Enterprise.

**Key pattern for Hour:** AI as background intelligence that enriches existing views rather than creating new ones. Suggestions with visible reasoning. The user stays in control.

---

### 1.2 Notion AI — Database AI Done Right (When It Works)

**AI Features:**
- **AI Autofill**: Custom AI fields in any database. Automatically classifies, summarizes, extracts tags, generates descriptions, suggests priorities from existing row data.
- **Custom Agents (3.0)**: Autonomous agents that handle complex workflows across workspace. Can edit inline, draft content, and run multi-step processes.
- **Inline editing**: Select text, ask for rewrite, changes happen in-place.
- **Auto-model selection**: Chooses between GPT-5.2, Claude Opus 4.5, Gemini 3 based on task type.

**How AI surfaces:**
Three modes: (1) Database autofill columns that run silently, (2) Inline text selection for rewrites/edits, (3) Agents that can be triggered or run autonomously. The autofill is the most "invisible" — it just populates fields as data arrives.

**What users love:**
- Database autofill for simple categorization and extraction (saves real time)
- Summarizing content: captures core message ~90% of the time
- Keyword extraction and categorization into predefined buckets
- Inline editing feels natural

**What users hate:**
- Inconsistent on complex properties requiring nuanced judgment
- Struggles with multi-step inference or when source content is thin
- Reddit community largely says "overpriced" and "not worth it for most users"
- AI quality varies wildly by task type

**Pricing:**
AI included with all plans. Notion AI was previously $8/mo add-on, now bundled.

**Key pattern for Hour:** Database autofill (AI as a column type) is a brilliant pattern for structured data. Works best for classification, extraction, and summarization — not for judgment calls. Don't overpromise what AI columns can do.

---

### 1.3 Height — AI-Native (Now Dead)

**AI Features (before shutdown Sept 2025):**
- Auto-suggested subtasks from high-level task descriptions
- Auto-filled tags (Feature, Customer, Impact) on new tasks
- Auto-prioritized bugs with immediate escalation of critical ones
- Auto-drafted progress updates for team review
- Duplicate detection

**What users loved:**
- "Create a task, get subtasks in seconds" was genuinely useful
- Auto-tagging reduced manual classification work

**Key pattern for Hour:** Height proved that going fully AI-native (AI does everything) can be too aggressive — users lost trust when AI made wrong calls without easy overrides. The company shut down. Lesson: AI should assist, not replace human judgment.

---

### 1.4 Asana — AI as Teammates

**AI Features:**
- **AI Teammates**: Assign tasks to AI agents like any team member. Pre-built roles: Campaign Brief Writer, Workflow Optimizer, Compliance Specialist.
- **Smart Status/Fields/Goals**: AI auto-generates status updates, fills custom fields, and drafts goal summaries.
- **Smart Rule Creator**: Describes a workflow in natural language, AI builds the automation rule.
- **AI Studio**: Build custom AI workflows with no code.
- **Smart Chat (MS 365 Copilot)**: Ask questions about project status, blockers, next steps.

**How AI surfaces:**
AI Teammates appear in the assignee field — they're "people" in the system. Smart features are inline (status auto-fills, goals auto-summarize). AI Studio is a dedicated builder for custom automations.

**What users love:**
- "AI Teammates" concept makes AI feel like part of the team, not a separate feature
- Smart Rule Creator saves hours of automation setup
- Goal alignment features genuinely useful for management

**What users hate:**
- AI Studio add-on is expensive ($150/mo for Plus)
- Can feel over-engineered for small teams
- Quality of AI-generated content varies

**Pricing:**
Basic AI included from Starter ($10.99/user/mo). AI Studio Basic included with rate limits. AI Studio Plus: $150/mo add-on. AI Studio Pro: annual plan only, custom pricing.

**Key pattern for Hour:** "AI as teammate" is a powerful metaphor that makes AI feel like a natural part of the workflow rather than a tool. But pricing AI features separately creates friction and resentment.

---

### 1.5 Monday.com — AI as Platform Builder

**AI Features:**
- **Monday Sidekick**: Personal AI assistant across boards, docs, and people. Cross-contextual.
- **Monday Magic**: Describe business flow in plain English, AI builds the solution (boards, automations, views).
- **Monday Vibe**: "Vibe coding" — build software in plain English on top of mondayDB.
- **Monday Agents**: AI specialists that execute tasks end-to-end (not just assist).
- **Service AI Assistant**: Analyzes tickets, suggests solutions from past resolutions.
- **Formula Builder, Docs Assistant**: Free AI features that don't consume credits.

**How AI surfaces:**
Sidekick is a persistent assistant. Magic and Vibe are creation tools. Agents run autonomously. The most useful features (Formula Builder, Docs) are free and inline.

**What users love:**
- Free AI features (Formula Builder, Docs) are the most genuinely useful
- "Describe your workflow, get a board" saves massive setup time
- Customizable dashboards with AI-generated insights

**What users hate:**
- Credit system is confusing
- "AI Agents" often over-promise and under-deliver on complex tasks
- Can feel bloated for teams that just want simple task management

**Pricing:**
Many AI features free (Formula Builder, Docs Assistant, Deal Insights). Credit-based system for advanced AI. Sidekick out of beta since Jan 2026.

**Key pattern for Hour:** Free basic AI (formula builder, smart fields) builds goodwill and adoption. Charging only for heavy AI usage (agents, complex automations) is the right pricing model.

---

### 1.6 Todoist — AI for Capture, Not Management

**AI Features:**
- **Todoist Ramble**: Voice-to-tasks. Speak naturally, AI transcribes and structures into tasks with dates, projects, and priorities. Uses Gemini 2.5 Flash Live for real-time speech.
- **Task Assist**: Generates subtask suggestions, helps break down complex tasks.
- **Filter Assist**: Creates custom filters from natural language descriptions.
- **Email Assist**: Converts forwarded emails into structured tasks.
- **Natural Language Input**: "Submit report every third Thursday" auto-formats correctly.

**How AI surfaces:**
AI lives primarily in the capture layer — when you're adding tasks. Natural language parsing is invisible (you just type normally). Ramble is a dedicated voice input mode. Filter Assist is a search/filter helper.

**What users love:**
- Ramble (voice-to-tasks) is genuinely transformative for ADHD users and on-the-go capture
- Natural language input feels invisible — you don't notice you're using AI
- 38 language support for Ramble
- Free tier gets limited Ramble access

**What users hate:**
- Limited AI beyond capture — no scheduling, no prioritization AI
- Task Assist subtask suggestions can be generic

**Pricing:**
Ramble included on all plans (limited sessions on free, unlimited on Pro/Business). No AI add-on fee.

**Key pattern for Hour:** AI in the capture layer is the most invisible and most loved. Natural language input should be default, not a feature. Voice-to-tasks is a killer feature for performing arts (people on stages, in vans, at venues).

---

### 1.7 ClickUp — AI Everywhere (Maybe Too Much)

**AI Features:**
- **ClickUp Brain**: Natural language Q&A about tasks, projects, deadlines. Workspace-aware.
- **Autopilot Agents**: No-code AI bots for repetitive tasks (status updates, task creation from meeting notes, client emails).
- **AI Notetaker**: Joins meetings (ClickUp SyncUps, Zoom, Teams), transcribes, creates searchable notes.
- **AI Planner**: Auto-scheduling based on priorities and deadlines.
- **AI Summarization**: Summarizes long threads, generates action items from comments.

**How AI surfaces:**
Brain is a search/chat interface. Agents run in background. Notetaker is a meeting companion. Summarization is inline on threads and comments.

**What users love:**
- Summarizing long threads and generating project briefs
- AI Notetaker saves manual meeting note work
- Free plan includes more AI than competitors' paid plans

**What users hate:**
- Overwhelming feature density — "easy to feel lost"
- Brain add-on costs $9/user/month on top of subscription
- Too many features means AI gets buried

**Pricing:**
ClickUp Brain: $9/member/month add-on. Not included in base plans.

**Key pattern for Hour:** Meeting-to-tasks pipeline (notetaker + action items + task creation) is a genuinely useful workflow. But AI add-on pricing on top of subscription creates resentment.

---

### 1.8 Sunsama — AI as Daily Ritual Guide

**AI Features:**
- **Daily Planning Ritual**: AI-guided morning planning that pulls tasks from connected tools, suggests time estimates based on your history, and helps set realistic daily goals.
- **Shutdown Ritual**: End-of-day reflection on what was accomplished, preparation for tomorrow.
- **AI Time Estimates**: Learns from your patterns — as you use it more, estimates get more accurate.
- **AI Channel Suggestions**: Auto-categorizes tasks based on past behavior.
- **AI Voice Assistant** (in development): Talk through your thoughts, AI turns them into a plan.

**How AI surfaces:**
AI is embedded in the ritual — it guides you through a structured flow (morning plan, evening review). It suggests but never forces. Time estimates appear inline as you add tasks. The AI is the methodology, not a feature.

**What users love:**
- Prevents overcommitment by learning your actual capacity
- "Advisor, not scheduler" philosophy feels respectful
- Daily ritual creates sustainable habits
- Wirecutter's top scheduling app pick (2025)
- Voice assistant concept (talk to think) resonates with many users

**What users hate:**
- No auto-scheduling (by design, but some want it)
- $20-25/month for essentially a daily planner
- Relatively simple AI compared to competitors

**Pricing:**
$20/mo (annual) or $25/mo (monthly). AI included in all plans.

**Key pattern for Hour:** AI as methodology guide (not just tool) is deeply resonant. Learning user patterns over time to improve suggestions is the right approach. The "advisor not scheduler" philosophy is exactly what Hour should aim for. Voice-to-plan for performing arts professionals who think out loud.

---

### 1.9 Motion — AI Auto-Scheduling (Cautionary Tale)

**AI Features:**
- **Auto-scheduling**: Analyzes priorities, deadlines, dependencies, meetings, energy levels, and work patterns to auto-schedule your entire day.
- **Dynamic rescheduling**: When plans change, AI reorganizes everything automatically.
- **AI Employees** (2026): Workflow automation agents beyond scheduling.

**How AI surfaces:**
AI controls the calendar. You add tasks with deadlines and priorities; Motion decides when you work on them. Changes propagate automatically.

**What users love:**
- "Saves 3-5 hours/week on admin"
- Best-in-class auto-scheduling when it works
- Removes decision fatigue about "what to work on next"

**What users hate:**
- **Packs days too tightly** — no room for unplanned work (most common complaint)
- Rigid — manual changes feel clunky once AI takes over
- Mobile app is terrible (2.7/5 Google Play)
- Difficult onboarding (2-4 weeks before value emerges)
- Pricing changes broke trust (annual only, no refunds, repeated increases)
- "Fix the core scheduling product first" before adding AI Employees

**Pricing:**
Individual plan ~$19-34/mo. Team plans higher. Annual billing only. No monthly option on most plans.

**Key pattern for Hour:** The biggest lesson in this research. Auto-scheduling that removes user control creates frustration and broken trust. AI should suggest time blocks, not force them. Users need room for unplanned work — especially in performing arts where chaos is normal. Also: fix core product before adding AI features.

---

### 1.10 Reclaim.ai — AI Calendar Defense

**AI Features:**
- **Focus Time**: Automatically defends time blocks for deep work.
- **Smart Meetings**: Finds optimal meeting times across all attendees.
- **Habits**: Schedules recurring routines at optimal moments.
- **Buffer Time**: Auto-schedules breaks and travel time between meetings.
- **Task Scheduling**: Intelligently schedules flexible task time based on priority and deadlines.
- **People Analytics**: Team-level insights for managers.

**How AI surfaces:**
AI operates on the calendar layer — it creates and moves events automatically but marks them as "flexible" so they can yield to more important things. Focus Time blocks appear on your calendar but auto-move when meetings are booked.

**What users love:**
- Focus Time protection genuinely helps knowledge workers
- Buffer time between meetings is a "why didn't this exist before" feature
- 524% more meeting availability vs Calendly
- G2: 9.8/10 for automated scheduling
- Free tier is genuinely useful

**What users hate:**
- No native mobile apps (as of late 2025)
- Free plan keeps getting cut back
- Calendar-only focus limits usefulness for task management

**Pricing:**
Free Lite plan (limited). Paid from $8/user/month.

**Key pattern for Hour:** Buffer time and travel time auto-calculation is hugely relevant for performing arts (travel between venues, setup time, load-in/load-out). "Flexible" blocks that yield to higher priorities is the right AI calendar model — defensive, not rigid.

---

## 2. CRM Tools with AI

### 2.1 Attio — AI-Native CRM Architecture

**AI Features:**
- **AI Attributes**: Custom fields on any object (people, companies, deals) that auto-fill using AI. Can summarize record history, classify contacts into segments, or run web research to fill missing data.
- **AI Workflows**: Multi-step automations with AI-powered triggers and classification steps.
- **Auto-enrichment**: Syncs email/calendar, identifies people and companies, queries public data for job titles, company size, location, funding, social links.
- **Research Agent**: AI agent that searches external sources to fill fields like funding stage, headcount, etc.

**How AI surfaces:**
AI is embedded in the data model itself — AI Attributes are just another column type. They populate automatically as data arrives. Enrichment happens silently on record creation. Workflows trigger on field changes, stage changes, or time conditions.

**What users love:**
- AI Attributes handling multi-thread email chains — "skim a deal's entire history in seconds"
- Auto-enrichment that actually works on record creation
- Object-based architecture lets AI work on any data type
- Free plan includes 3 seats with basic enrichment

**What users hate:**
- Credit system can burn through quickly with Research Agent (10 credits per run)
- Long email threads with mixed topics produce imperfect summaries
- Annual billing only on paid plans

**Pricing:**
Free: 3 seats, basic enrichment. Plus: $29/user/mo. Pro: $59/user/mo (includes 10,000 workspace AI credits/month). Enterprise: custom. Two-layer credit system (seat + workspace).

**Key pattern for Hour:** AI as a column type in the data model is the cleanest integration pattern in this research. Records enrich themselves on creation. AI workflows trigger on data changes. This is exactly how Hour should handle venue, promoter, and contact data.

---

### 2.2 Folk — AI That Follows Up for You

**AI Features:**
- **1-click enrichment**: LinkedIn data, company info, role — auto-populates on contact creation via Chrome extension.
- **Smart Contact Merge**: Auto-groups and cleans duplicates across lists.
- **Follow-up Assistant**: Analyzes email and WhatsApp conversations to detect inactive discussions with pending next steps. Sends notification with pre-written follow-up in your tone of voice.
- **Deal-stage prompts**: AI recommends next actions when opportunity stages change.
- **Auto-draft emails & sequences**: AI drafts based on conversation context.
- **Research notes**: Generates research briefing on contacts using People Data Labs + Perplexity.

**How AI surfaces:**
Enrichment is automatic on import. Follow-up Assistant sends notifications (not inline). Deal prompts appear on stage changes. Drafts appear in email compose. Research notes are generated on demand.

**What users love:**
- Follow-up detection is genuinely useful — catches dropped conversations
- Research notes save 10-15 min per contact
- Chrome extension for LinkedIn capture is seamless
- "In your tone of voice" follow-ups feel personal

**What users hate:**
- Enrichment has monthly limits per plan
- Not as deep as Clay for serious data enrichment
- Limited for teams larger than ~20

**Pricing:**
Enrichment included with all plans (monthly limits vary). Plans from $20/user/mo.

**Key pattern for Hour:** Follow-up detection is a killer feature for performing arts — booking agents and managers juggle dozens of conversations with venues and promoters. AI that watches for dropped threads and suggests follow-ups (in context, in your tone) would be transformative. Deal-stage prompts (booking stage changes trigger suggested actions) map perfectly to the booking pipeline.

---

### 2.3 HubSpot — AI at Enterprise Scale

**AI Features:**
- **Breeze Assistant** (fka Copilot): Persistent AI assistant with memory across conversations. Integrates with Google Workspace, Slack, Microsoft 365.
- **AI Forecasting**: Predicts deal close probability from historical data.
- **Predictive Lead Scoring**: Ranks leads by likelihood to convert.
- **Customer Agent**: Resolves 70% more tickets using documentation, customer data, and conversation history.
- **Breeze Studio**: Build custom agents with GPT-5. Trigger agents within workflows.

**How AI surfaces:**
Breeze Assistant is a sidebar/chat companion. Forecasting and scoring are dashboard widgets. Customer Agent runs autonomously on ticket queues.

**What users love:**
- Predictive lead scoring actually works with enough data
- Customer Agent for support ticket resolution
- Deep integrations across the entire HubSpot ecosystem

**What users hate:**
- Enterprise pricing makes AI inaccessible for SMBs
- Breeze Assistant can feel generic without heavy customization
- Feature bloat — hard to know what AI features exist

**Pricing:**
Some AI included across plans. Advanced AI features on Professional ($800+/mo) and Enterprise ($3,600+/mo). Free tier has basic AI.

**Key pattern for Hour:** Predictive scoring on deals is interesting for booking — predicting which venue/promoter conversations are most likely to close. But HubSpot's complexity is a counter-example: AI features shouldn't require training to discover.

---

### 2.4 Clay — AI Enrichment at Scale

**AI Features:**
- **Waterfall enrichment**: Checks 100+ data sources sequentially until complete profiles emerge.
- **Claygent**: AI research agent that scrapes public web data (office locations, founder backgrounds, company initiatives).
- **AI-crafted outreach**: Personalizes messages per contact based on enriched data.
- **Functions**: Reusable enrichment workflows that run everywhere and auto-update.
- **CRM auto-sync**: Pushes enriched data to CRM, email tools, ad platforms on recurring basis.

**How AI surfaces:**
Spreadsheet-like interface where each column can be an enrichment source or AI operation. Data flows through the table automatically.

**What users love:**
- Waterfall enrichment (try source A, if missing try B, then C) is brilliant
- Claygent for custom research queries
- "Build once, run forever" Functions

**What users hate:**
- Expensive ($185/mo minimum, $495/mo for CRM sync)
- Steep learning curve
- Credit system burns fast at scale

**Pricing:**
Launch: $185/mo (2,500 credits). Growth: $495/mo (6,000 credits). Scale/Enterprise: higher.

**Key pattern for Hour:** Waterfall enrichment concept is relevant — for venues and promoters, try official database first, then LinkedIn, then web search, until profile is complete. But Clay's complexity and pricing are a counter-example for Hour's target market.

---

## 3. Cross-Tool Patterns

### 3.1 How AI Surfaces Across Tools

| Pattern | Examples | User Reception |
|---------|----------|----------------|
| **Inline suggestions** | Linear (triage), Notion (autofill) | Loved — non-disruptive, contextual |
| **Sidebar/chat copilot** | HubSpot Breeze, Monday Sidekick | Mixed — useful for Q&A, feels bolted-on for actions |
| **Autonomous agents** | Asana AI Teammates, Monday Agents | Polarizing — exciting in demos, disappointing in practice |
| **Background enrichment** | Attio, Folk, Clay | Loved — invisible value-add |
| **AI as column type** | Notion Autofill, Attio AI Attributes | Loved — natural, fits existing mental models |
| **Guided ritual** | Sunsama daily planning | Loved — AI shapes behavior, not just data |
| **Full automation** | Motion auto-scheduling | Divisive — saves time but removes agency |
| **Voice/NLP capture** | Todoist Ramble | Loved — lowers friction dramatically |

### 3.2 Pricing Models for AI

| Model | Examples | User Reception |
|-------|----------|----------------|
| AI included in all plans | Linear, Todoist, Sunsama | Best adoption, builds loyalty |
| AI as paid add-on per seat | ClickUp ($9/user/mo) | Creates resentment |
| Credit-based system | Attio, Monday.com, Asana | Confusing, creates anxiety about usage |
| AI only on expensive plans | HubSpot, Linear (Triage) | Acceptable if core AI is free |
| Tiered AI (basic free, advanced paid) | Asana (AI Studio), Monday (free features + credits) | Best compromise |

---

## 4. What Users Genuinely Love vs What Feels Gimmicky

### Genuinely Loved

1. **Natural language input** (Todoist) — "I just type what I mean and it works." Invisible AI.
2. **Auto-enrichment on record creation** (Attio, Folk) — "I add a contact and it fills itself in." Zero extra effort.
3. **Triage suggestions with reasoning** (Linear) — "It tells me why it thinks this, so I can decide fast."
4. **Follow-up detection** (Folk) — "It caught a conversation I forgot about. Saved a deal."
5. **Buffer time and travel time** (Reclaim) — "Why didn't every calendar do this from day one?"
6. **Meeting summarization and action items** (ClickUp) — Universally useful, hard to get wrong.
7. **AI time estimates that learn** (Sunsama) — Gets better over time, respects your actual capacity.
8. **Database autofill for classification** (Notion) — Works for simple categorization, saves manual work.

### Feels Gimmicky or Annoying

1. **AI chatbots/copilots** — Most sidebar AI assistants feel like bolted-on ChatGPT. Users prefer inline actions.
2. **AI-generated content** (status updates, emails) — Often too generic. Users edit 80% of output.
3. **Autonomous agents** — The 15-30% failure rate on complex tasks makes users distrust them.
4. **Auto-scheduling that removes control** (Motion) — Users feel trapped when AI packs their day.
5. **Credit systems** — Create anxiety and confusion. Users don't want to think about AI "budget."
6. **"Vibe coding" / build-with-AI** (Monday Vibe) — Cool demos, unreliable in production.
7. **AI features locked behind expensive plans** — Feels like withholding value.
8. **Over-promising on "AI Teammates"** — When AI agents make wrong decisions, trust damage is severe.

---

## 5. Recommendations for Hour

### Philosophy: The Invisible Hand

Hour's AI should feel like a well-trained stage manager — always watching, anticipating needs, preparing things in advance, but never stepping on stage unless called. The best AI in this research is the AI users forget they're using.

### Tier 1: Build First (Core, Invisible)

These features should be built into Hour from day one. No AI branding, no sparkle icons, no "powered by AI" labels. They just work.

1. **Natural language input everywhere** — "Add show Barcelona June 15 Razzmatazz 2500 guarantee" creates a booking with all fields parsed. Date, venue, financial terms — AI handles the structure.

2. **Contact/venue auto-enrichment** — Add a venue name, AI fills capacity, address, technical specs (from public sources). Add a promoter, AI finds their email, company, recent shows. Waterfall approach: try database first, then web.

3. **Smart defaults and field suggestions** — When creating a booking for a venue you've played before, auto-fill with previous terms. When adding a show date, auto-suggest load-in time, soundcheck, doors based on venue history or genre norms.

4. **Duplicate detection** — Flag when a venue, contact, or show might be a duplicate. Non-blocking: show a subtle warning, let user merge or dismiss.

5. **Buffer/travel time calculation** — When shows are scheduled, auto-calculate travel time between venues. Flag unrealistic routing (show in Barcelona Tuesday, show in Madrid Tuesday night).

### Tier 2: Build Next (Valuable, Semi-visible)

These features have clear value and users should know they exist, but they still work quietly.

6. **Follow-up detection** — Monitor email/message threads with venues and promoters. When a conversation goes quiet and there's a pending next step (contract unsigned, advance not completed), surface a notification: "Razzmatazz hasn't responded about the advance in 5 days. Suggested follow-up: [draft]."

7. **Booking pipeline intelligence** — When a deal moves between stages (inquiry > offer > confirmed > contracted > advanced), suggest the next action: "Show confirmed. Next steps: send advance form, request tech rider, add to tour calendar."

8. **Smart status updates** — For tours with multiple shows, auto-generate status summary: "Tour: 8/12 shows confirmed, 3 pending contract, 1 needs re-routing. Advance complete on 5 shows."

9. **Document extraction** — Upload a contract PDF, AI extracts key terms (guarantee, percentage, buyout, technical requirements, cancellation terms) into structured fields. Upload a tech rider, AI extracts stage plot and input list.

10. **Meeting/call notes to actions** — After a call with a venue, dictate notes. AI extracts tasks (send contract, confirm dates, add catering rider) and suggests creating them.

### Tier 3: Build Later (Powerful, Visible)

These features are explicitly AI-powered and users interact with them knowingly.

11. **Tour routing optimization** — Given a list of target cities/venues and a date range, suggest optimal routing considering geography, venue availability patterns, and day-of-week preferences.

12. **Financial projections** — Based on historical data (past guarantees, ticket sales, costs), project revenue for upcoming shows. Flag shows where projected costs exceed projected income.

13. **AI-powered search across everything** — "Show me all venues in Catalonia we played in 2025 with capacity over 300" → instant results from natural language query.

14. **Pattern recognition** — "Shows on Thursdays in Madrid consistently sell 20% less than Fridays" — surface insights from historical data without being asked.

15. **Seasonal planning intelligence** — "Based on past years, booking requests for summer festivals typically start in January. You have 0 festival applications submitted for 2027." Gentle, calendar-aware nudges.

### How to Surface AI in Hour's UI

| Feature Type | How to Surface |
|---|---|
| Natural language input | Default text fields that "just work" — no AI indicator needed |
| Auto-enrichment | Fields auto-populate with subtle animation. Source shown on hover. |
| Suggestions | Inline, below the relevant field. Gray text, one-click accept. Dismiss with Esc. |
| Follow-up detection | Notification badge on the contact/booking. Not a push notification. |
| Status summaries | Card/widget in dashboard. Updated automatically, not on-demand. |
| Document extraction | After upload, show extracted fields for review before saving. Never auto-apply. |
| Tour routing | Dedicated view triggered by user ("Plan route"). Results are suggestions, not decisions. |
| Search/query | Natural language search bar. Results feel like search, not chat. |

### AI Pricing for Hour

Based on this research, the clear recommendation:

- **Core AI (Tier 1) included in all plans.** This is table stakes. It's what makes Hour feel modern.
- **Tier 2 AI included from mid-tier plan.** Follow-up detection, pipeline intelligence, document extraction.
- **Tier 3 AI on top-tier plan or as measured add-on.** Tour routing, financial projections, advanced analytics.
- **Never use a credit system.** It creates anxiety and makes users avoid the AI.
- **Never charge per-AI-feature.** Bundle by plan tier.

---

## 6. The "Invisible AI" Playbook

### Principles

1. **AI should reduce clicks, not add them.** Every AI interaction should make the user do less, not present them with more choices.

2. **Suggestions over actions.** AI suggests, user accepts (or ignores). AI never takes irreversible actions without confirmation. The one exception: enriching empty fields with public data (low-risk, high-value).

3. **Reasoning should be accessible, not forced.** Like Linear: hover to see why. Don't explain by default — most users trust the suggestion. But the reasoning is always one hover away.

4. **Learn from behavior, not from configuration.** Sunsama's approach: the more you use it, the better it gets. Don't ask users to "train" the AI. Observe and adapt.

5. **AI should feel like good defaults, not automation.** When a user creates a new show and the load-in time is pre-filled to 14:00, they shouldn't think "the AI filled this in." They should think "the app knows what I need."

6. **Never use AI branding where it isn't needed.** No sparkle icons, no "AI-powered" badges, no "Ask AI" buttons for things that should just work. Reserve explicit AI interaction for genuinely complex features (tour routing, financial projections).

7. **The first wrong suggestion costs more than ten right ones.** Start conservative. Only suggest when confidence is high. A wrong auto-fill erodes trust faster than a missing one. Better to leave a field empty than fill it wrong.

8. **AI in capture, not in execution.** AI should help get information IN (natural language, voice, document extraction) and help surface insights OUT (summaries, follow-ups, patterns). The execution in between is human.

### Anti-Patterns to Avoid

- **The chatbot trap**: Don't build a sidebar AI chat. It fragments the experience and users stop using it after week one.
- **The autonomous agent fantasy**: Don't promise AI that "handles bookings for you." Performing arts is relationship-driven — AI should augment the human, not replace them.
- **The feature-flag approach**: Don't add AI as toggleable features. Bake it into the product. Users shouldn't have to "turn on AI."
- **The demo-driven feature**: Don't build AI features that look amazing in demos but fail in daily use. Tour routing should work for 5 shows, not just the perfect 20-show example.
- **Over-notification**: Follow-up detection should surface in-app, not spam email/Slack. One quiet notification beats five urgent ones.

---

## Sources

- [Linear Triage Intelligence Docs](https://linear.app/docs/triage-intelligence)
- [Linear AI Overview](https://linear.app/now/ai)
- [Linear Auto-Apply Triage Changelog](https://linear.app/changelog/2025-09-19-auto-apply-triage-suggestions)
- [Notion AI Product Page](https://www.notion.com/product/ai)
- [Notion AI Agent 2026 Guide](https://thecrunch.io/notion-ai-agent/)
- [Height App Overview](https://height.app/)
- [Asana Winter 2026 Release](https://asana.com/inside-asana/winter-release-2026)
- [Asana Fall 2025 Release](https://asana.com/inside-asana/fall-release-2025)
- [Monday.com AI Page](https://monday.com/w/ai)
- [Monday AI 2026 Overview](https://till-freitag.com/en/blog/monday-ai-features-en)
- [Todoist Ramble Launch](https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/)
- [ClickUp AI Features Roundup](https://tuckconsultinggroup.com/articles/clickup-ai-features-roundup-whats-new-in-2025/)
- [ClickUp Brain Review](https://gmelius.com/blog/clickup-brain-ai-review)
- [Sunsama AI Features](https://www.sunsama.com/features/ai)
- [Sunsama Review 2026](https://calmevo.com/sunsama-review/)
- [Motion AI Review 2026](https://max-productive.ai/ai-tools/motion-ai/)
- [Motion App Review](https://thebusinessdive.com/motion-app-review)
- [Reclaim.ai](https://reclaim.ai/)
- [Reclaim AI Review 2026](https://max-productive.ai/ai-tools/reclaim-ai/)
- [Attio CRM](https://attio.com/)
- [Attio Review 2026](https://crm.org/news/attio-review)
- [Folk CRM AI Features](https://www.folk.app/articles/folk-crm-ai-features)
- [HubSpot Breeze AI Guide](https://www.hublead.io/blog/hubspot-ai-tools)
- [HubSpot Spring 2026 Spotlight](https://www.hubspot.com/spotlight)
- [Clay](https://www.clay.com)
- [Clay Review 2026](https://work-management.org/crm/clay-review/)
- [Notion AI Autofill Guide](https://www.eesel.ai/blog/notion-ai-autofill)
- [Ambient Intelligence 2026](https://iankhan.com/the-rise-of-ambient-intelligence-how-2026s-invisible-tech-will-transform-business-and-society/)
- [AI PM Tools Comparison](https://www.morgen.so/blog-posts/best-ai-project-management-tools)
