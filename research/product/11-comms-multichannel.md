# Communication Layer Research — Multichannel Messaging in B2B SaaS

> Last updated: 2026-04-20
> Context: Hour Deferred D4 — unified email/WhatsApp/Telegram/calls contextualised by House/Room
> Scope: How modern tools handle multichannel comms tied to CRM records, and what architecture Hour should adopt

---

## 1. Tool-by-Tool Analysis

### 1.1 Front (front.com)

**What it is:** Shared inbox platform. Unifies email, live chat, SMS, WhatsApp, and social into a single team workspace.

**Channel unification:** All channels appear as conversations in one inbox. Team members can be assigned, conversations tagged, and SLAs tracked across channels. Each conversation shows full history regardless of channel.

**Contact/record linking:** Integrates with external CRMs (Salesforce, HubSpot) to pull customer context into the sidebar. No native CRM — relies on integrations for contact-record association.

**WhatsApp:** Supported via WhatsApp Business API. Available on Professional and Enterprise plans only. No Telegram support.

**Pricing:**
- Starter: $19/seat/mo (email only, max 10 seats)
- Growth: $59/seat/mo (multichannel, max 35 seats)
- Scale: $99/seat/mo (20+ seats minimum)
- Premier: $229/seat/mo (50+ seats minimum)

**UX pattern:** Unified inbox with conversation threads. Left panel = inbox list, center = conversation, right panel = contact context from CRM. Messages from any channel appear in the same list.

**Verdict for Hour:** Too expensive for the target segment. No native CRM. Designed for support teams, not sales/relationship CRMs. No Telegram.

---

### 1.2 Missive (missiveapp.com)

**What it is:** Team inbox + internal chat. Collaborative email with multichannel support.

**Channel unification:** Email, SMS (via Twilio), WhatsApp, Messenger, Instagram — all in one inbox. Conversations can be shared, assigned, and commented on internally. All channels available on all paid plans.

**Contact/record linking:** Basic contact management. No deal/pipeline features. Conversations auto-linked to contacts by phone/email.

**WhatsApp:** Native integration via WhatsApp Business API. **No Telegram support.**

**Pricing:**
- Starter: $14/user/mo
- Productive: $24/user/mo
- Business: $36/user/mo

**UX pattern:** Unified inbox with internal chat overlay. Conversations are threaded. Team members can draft together in real-time (Google Docs-style collaborative drafting).

**Verdict for Hour:** Best price-to-channel ratio of any inbox tool. But it's a communication tool, not a CRM. No contact records, no deal tracking, no timeline view per contact. No Telegram. Would need to be used alongside Hour, not embedded in it.

---

### 1.3 Crisp (crisp.chat)

**What it is:** Customer messaging platform. Live chat + multichannel inbox + knowledge base + CRM.

**Channel unification:** Email, live chat, WhatsApp Business, Telegram, Messenger, Instagram, Viber, Line, SMS. Broadest native channel support of any tool reviewed.

**Contact/record linking:** Built-in lightweight CRM with contact profiles. Conversations auto-linked to contacts. Timeline view per contact showing all interactions across channels.

**WhatsApp:** Via WhatsApp Business API. **Telegram:** Native support via Bot API.

**Pricing (per workspace, not per seat):**
- Free: 2 agents, live chat only
- Mini: €45/mo (email + basic channels)
- Essentials: €95/mo (all channels, automations, analytics)
- Plus: €295/mo (AI, ticketing, white-label)
- Unlimited conversations on all plans

**UX pattern:** Unified inbox with contact sidebar. Conversations grouped by contact. Each contact has a timeline showing all interactions. Per-workspace pricing means no per-seat scaling.

**Verdict for Hour:** Strong candidate for architecture reference. Has both WhatsApp and Telegram. Per-workspace pricing is interesting for small teams. But it's customer-support-oriented (reactive), not sales/outreach-oriented (proactive). The contact timeline pattern is exactly what Hour needs.

---

### 1.4 Intercom

**What it is:** Customer communication platform. Messenger, email, in-app, WhatsApp, SMS.

**Channel unification:** Live chat, email, in-app messages, WhatsApp, SMS, phone. Unified inbox with AI agent (Fin). Strong automation and workflow engine.

**Contact/record linking:** Full customer data platform. Every conversation linked to a user profile with event history, company data, custom attributes. Timeline view per contact.

**WhatsApp:** Pay-per-conversation ($0.07-0.10 per session). **No native Telegram integration.**

**Pricing:**
- Essential: $29/seat/mo
- Advanced: $85/seat/mo
- Expert: $132/seat/mo
- Plus: WhatsApp, SMS, email campaigns billed separately on top

**UX pattern:** Inbox + Messenger widget. Conversations threaded by contact. Left panel = conversation list with filters, center = thread, right panel = customer profile with attributes, events, notes.

**Verdict for Hour:** Way too expensive for the target segment. Per-seat + per-message + per-resolution pricing adds up fast. No Telegram. Designed for product companies with thousands of users, not B2B relationship management.

---

### 1.5 HubSpot

**What it is:** Full CRM suite with marketing, sales, service hubs. Communication is one layer within a larger platform.

**Channel unification:** Email, live chat, WhatsApp, Facebook Messenger, forms, calls — all in a shared inbox called "Conversations." Each conversation linked to a CRM contact/deal record.

**Contact/record linking:** Native and deep. Every message, email, call, meeting auto-logged on the contact timeline. Conversations linked to deals and tickets. This is the CRM-first approach — communication is a feature of the CRM, not the other way around.

**WhatsApp:** Native integration via WhatsApp Business API. Only available on **Pro plan ($800+/mo)** or Enterprise. 1,000 free conversations/mo, then $70 per additional 1,000. **No Telegram.**

**Pricing for communication features:**
- Free CRM: email only (no WhatsApp, no shared inbox)
- Starter ($20/mo): shared inbox, basic chat
- Pro ($800+/mo): WhatsApp, advanced automation, sequences
- Enterprise ($3,600+/mo): everything

**UX pattern:** Contact timeline. Every interaction (email, call, meeting, WhatsApp, form submission, page visit) appears chronologically on the contact record. The inbox is secondary — the contact record is primary.

**Verdict for Hour:** The contact timeline pattern is the gold standard for CRM communication. But HubSpot's pricing makes WhatsApp a luxury feature ($800+/mo). The architecture is right but the implementation is too heavy and expensive.

---

### 1.6 Attio

**What it is:** Modern, flexible CRM. Relationship-first, data-model-flexible.

**Channel unification:** Email (Gmail/Outlook sync) and calendar are native. WhatsApp available via third-party integrations (Zapier, Latenode) — not native. No Telegram.

**Contact/record linking:** Excellent. Auto-enrichment from email/calendar data. Every interaction appears on the record timeline. Custom objects allow flexible data modeling.

**WhatsApp:** Not native. Requires Zapier or third-party middleware. Messages can be synced to contact records but it's not a first-class experience.

**Pricing:**
- Free: 3 users, basic features
- Plus: $29/user/mo
- Pro: $59/user/mo
- Enterprise: $119/user/mo

**UX pattern:** Record-centric timeline. Each contact/company/deal has a timeline with all interactions. No unified inbox — communication is viewed through the lens of the record.

**Verdict for Hour:** Best example of the modern CRM data model (custom objects, flexible records). But communication is weak — email-only native, everything else via integrations. Architecture inspiration for the CRM side, not the communication side.

---

### 1.7 Folk (folk.app)

**What it is:** Lightweight CRM for relationship management. Contact-centric with email and WhatsApp.

**Channel unification:** Email (Gmail/Outlook) and WhatsApp natively synced. LinkedIn via browser extension. Calendar sync. All interactions appear on a unified contact timeline.

**Contact/record linking:** Every email and WhatsApp message auto-linked to the contact record. AI detects stale conversations and suggests follow-ups. Pipeline/deal tracking available.

**WhatsApp:** Native sync on Premium plan ($40/user/mo). Captures WhatsApp conversations and links them to contacts. Templates and bulk sends supported. **No Telegram.**

**Pricing:**
- Standard: $20/user/mo (email only)
- Premium: $40/user/mo (WhatsApp, deals, sequences)
- Custom: $80+/user/mo

**UX pattern:** Contact timeline with channel indicators. Each contact shows email + WhatsApp + LinkedIn interactions in chronological order. AI-powered follow-up suggestions.

**Verdict for Hour:** Closest to what Hour needs architecturally. CRM-first with WhatsApp as a first-class channel. The "AI detects stale conversations" feature is directly relevant to Hour's engagement workflow. Missing Telegram though.

---

### 1.8 Respond.io

**What it is:** Conversational CRM. Built specifically for messaging-first businesses. All channels unified.

**Channel unification:** WhatsApp, Telegram, Instagram, Facebook Messenger, email, SMS, TikTok, Viber, LINE, WeChat — the broadest channel support. All conversations in one inbox. Contact merging across channels.

**Contact/record linking:** Each contact has a unified profile with all conversations across all channels. When the same person messages on WhatsApp and Telegram, profiles can be merged. Custom fields and tags on contacts.

**WhatsApp:** Native via Cloud API. No markup on Meta fees. **Telegram:** Native via Bot API.

**Pricing:**
- Starter: $79/mo (5 users, unlimited contacts)
- Growth: $159/mo (10 users, 1,000 MACs)
- Advanced: $279/mo (10 users, advanced automation)
- Enterprise: custom

**UX pattern:** Unified inbox with contact sidebar. Conversations listed by recency, filterable by channel/tag/assignee. Each contact has a merged profile showing all channel interactions. Workflow automation builder for routing and auto-replies.

**Verdict for Hour:** Most relevant tool for the messaging architecture. Has both WhatsApp AND Telegram natively. Contact merging across channels is critical for the performing arts context (same programmer on WhatsApp and email). But $79/mo minimum and it's a standalone platform — can't be embedded into Hour's UI. Study their contact merging and channel unification patterns.

---

## 2. Open-Source / Low-Cost Solutions

### 2.1 Chatwoot

**What it is:** Open-source customer engagement platform. MIT license. Self-hostable.

**Channels:** Live chat, email, WhatsApp, Telegram, Facebook, Instagram, Twitter, Line, SMS. All channels in one inbox.

**WhatsApp:** Via WhatsApp Cloud API (direct) or via Twilio/360dialog BSP. **Telegram:** Native via Bot API.

**Pricing:**
- Community (self-hosted): Free (MIT license)
- Cloud Hacker (free): 2 agents, 500 conversations/mo, live chat only
- Cloud Startups: $19/agent/mo (all channels)
- Cloud Business: $39/agent/mo
- Cloud Enterprise: $99/agent/mo

**Self-hosted hidden costs:** Server ($16+/mo on Elestio), WhatsApp BSP fees, engineering time for maintenance.

**Architecture:** Ruby on Rails backend, PostgreSQL, Redis. REST + WebSocket APIs. Webhooks for integrations. Each conversation has a contact, and contacts can have custom attributes.

**Verdict for Hour:** Best open-source option. Could be self-hosted alongside Hour's infrastructure or used as an embedded component. The API could be used to sync conversations into Hour's engagement records. But it's a support tool, not a CRM — the contact model is thin.

---

### 2.2 Rocket.Chat

**What it is:** Open-source team communication platform with omnichannel features.

**Channels:** WhatsApp, Telegram, Facebook, Instagram, email, SMS — via omnichannel module.

**WhatsApp:** Via 360dialog or Twilio. **Telegram:** Native via Bot API.

**Pricing:**
- Community (self-hosted): Free
- Enterprise: custom pricing
- Omnichannel features available in community edition but some require enterprise

**Verdict for Hour:** More of an internal team chat tool (Slack alternative) that added omnichannel. The omnichannel module is secondary to its core purpose. Less mature than Chatwoot for external communication. Would not recommend for Hour.

---

## 3. Technical Architecture: WhatsApp Integration

### 3.1 WhatsApp Business API — The Standard

Since October 2025, Meta has fully deprecated the On-Premises API. **WhatsApp Cloud API is the only path.**

**Two integration approaches:**

| Approach | Pros | Cons |
|----------|------|------|
| **Direct Cloud API** (Meta) | No BSP markup, full control, free API access | Must handle webhooks, template management, media storage, compliance yourself |
| **Via BSP** (Twilio, 360dialog, MessageBird) | Managed dashboard, multi-agent routing, analytics, simplified templates | Per-message markup ($0.002-0.005), monthly platform fee ($30-500+/mo) |

**For Hour specifically:** Direct Cloud API is the right choice. Hour already has Cloudflare Workers + Supabase — the webhook handler, template storage, and message logging can be built directly into the existing stack. No need for a BSP middleman.

### 3.2 Per-Message Costs (Spain, 2026)

Since July 2025, pricing is **per message delivered** (not per conversation):

| Category | Spain (EUR) | Use case |
|----------|-------------|----------|
| Marketing | €0.0509 | Bulk outreach, newsletters |
| Utility | €0.0166 | Booking confirmations, schedule updates |
| Authentication | €0.0166 | Login codes |
| Service | **Free** | Reply within 24h of customer message |

**Cost estimate for Hour Phase 0 (MaMeMi difusion):**
- 154 engagements contacted once/season via WhatsApp utility: 154 x €0.0166 = **€2.56/season**
- Monthly follow-up to 30 active conversations: 30 x €0.0166 = **€0.50/month**
- Service replies (within 24h window): **free**
- **Total estimated cost: <€5/month** — negligible

**Cost estimate for Phase 1 (15 workspaces, ~200 engagements each):**
- 3,000 utility messages/month: 3,000 x €0.0166 = **€49.80/month**
- Service replies: free
- Marketing messages (if offered): would add cost per send
- **Total: ~€50-100/month across all tenants** — passable to tenants as usage-based billing

### 3.3 Requirements for WhatsApp Cloud API Integration

1. **Meta Business Account** (verified) — per tenant workspace
2. **WhatsApp Business Profile** — phone number per workspace
3. **App on Meta Developer Portal** — one app for Hour (multi-tenant)
4. **Webhook endpoint** — Cloudflare Worker receives message events
5. **Message templates** — pre-approved by Meta for outbound messages
6. **24-hour service window** — free replies within 24h of customer message
7. **Media handling** — images, documents via R2 bucket (already in stack)

**Multi-tenant architecture:**
- Each Hour workspace connects their own WhatsApp Business number
- Hour registers one Meta App with a webhook URL
- Webhook receives events for all workspaces, routes by phone number ID
- Messages stored in Hour's Supabase DB, linked to engagement records

---

## 4. Technical Architecture: Telegram Integration

### 4.1 Telegram Bot API — The Standard

**Two approaches:**

| Approach | Pros | Cons |
|----------|------|------|
| **Bot API** (official) | Free, well-documented, easy to implement, webhooks supported | Bot initiates conversation only after user messages first. Bot username visible. |
| **Userbot / MTProto** | Full user account access, can initiate conversations, read history | Against Telegram ToS for commercial use, account ban risk, complex to maintain |

**For Hour:** Bot API is the only viable option. Userbot approach is fragile and violates ToS.

### 4.2 Bot API Specifics

- **Cost:** Completely free. No per-message fees. No API access fees.
- **Setup:** Create bot via @BotFather, get token, set webhook URL
- **Limitations:** Bot cannot initiate conversation — user must message the bot first (or click a t.me/botname link). Bot cannot see messages in groups unless mentioned or set as admin.
- **Multi-tenant:** Each workspace creates their own bot, or Hour provides a central bot with workspace routing.

### 4.3 Practical Implications for Performing Arts

In the Spanish performing arts context, the Telegram limitation (user must message first) is significant:
- A company can't cold-message a programmer on Telegram via bot
- But they CAN share a "Contact us on Telegram" link that opens the bot
- Once the programmer messages the bot, the conversation is open indefinitely
- Best use: include bot link in dossiers, email signatures, and outreach materials

**Recommended approach:** Each workspace has a Telegram bot. The bot link is embedded in email signatures and dossier PDFs. When a venue programmer clicks it, the conversation starts and is linked to their engagement record in Hour.

---

## 5. UX Patterns Compared

### 5.1 Three Patterns Observed

| Pattern | Used by | Description | Best for |
|---------|---------|-------------|----------|
| **Unified inbox** | Front, Missive, Chatwoot, Respond.io | All messages from all channels in one chronological list. Filter by channel, tag, assignee. | Support teams handling high volume |
| **Contact timeline** | HubSpot, Attio, Folk | All interactions (email, WhatsApp, calls, meetings) shown on the contact record chronologically. No separate inbox. | Relationship-driven sales/CRM |
| **Hybrid** | Crisp, Intercom, Respond.io | Unified inbox as primary view, but each contact also has a timeline. Can navigate either way. | Teams that need both reactive (inbox) and proactive (timeline) views |

### 5.2 Analysis for Hour

Hour is a **CRM for relationships** (engagements with venues/programmers), not a **support desk** for customer queries. This means:

- The primary view should be the **engagement record** with a communication timeline, not an inbox
- Users look up a specific venue programmer and see all communication history (email sent, WhatsApp exchange, call note, dossier sent)
- A secondary inbox view is useful for "what needs my attention now" but it's not the primary workflow

**The contact timeline pattern is the right fit.** Specifically:
- Each engagement record has a "Comms" tab or section
- Timeline shows: emails (sent/received), WhatsApp messages, Telegram messages, call logs, notes
- Each entry shows: channel icon, timestamp, preview, full content on click
- Outbound actions (send email, send WhatsApp, log call) are available from the engagement record
- An optional "Inbox" lens (future) shows all unread/pending messages across all engagements

---

## 6. Architecture Recommendation for Hour

### 6.1 Principle: Communication as a Feature, Not a Product

Hour should NOT build a standalone messaging platform. Instead:
- Communication is a **layer** on top of the engagement entity
- Each message (sent or received) is a record linked to an engagement
- The engagement timeline is the primary view
- Channel integrations (email, WhatsApp, Telegram) are modular — add one at a time

### 6.2 Proposed Data Model

```
message
  id              UUID v7
  workspace_id    UUID (RLS)
  engagement_id   UUID (FK → engagement)
  channel         ENUM: email | whatsapp | telegram | call | note
  direction       ENUM: inbound | outbound
  status          ENUM: sent | delivered | read | failed | draft
  from_address    TEXT (email, phone, or telegram handle)
  to_address      TEXT
  subject         TEXT (email only)
  body            TEXT
  metadata        JSONB (channel-specific: message_id, template_name, media_urls)
  sent_at         TIMESTAMPTZ
  created_at      TIMESTAMPTZ
  created_by      UUID (FK → profile)
```

### 6.3 Integration Architecture

```
                    ┌─────────────────────────┐
                    │   Hour Cloudflare Worker │
                    │   /api/webhooks/whatsapp │
                    │   /api/webhooks/telegram │
                    │   /api/send/whatsapp     │
                    │   /api/send/email        │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
    ┌─────────▼──────┐ ┌────────▼────────┐ ┌───────▼────────┐
    │ WhatsApp Cloud  │ │ Telegram Bot    │ │ Resend (email) │
    │ API (Meta)      │ │ API             │ │ Already in     │
    │ Direct, no BSP  │ │ Free            │ │ stack          │
    └────────────────┘ └─────────────────┘ └────────────────┘
              │                  │                   │
              └──────────────────┼──────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Supabase (message DB)  │
                    │   + engagement FK        │
                    │   RLS by workspace_id    │
                    └─────────────────────────┘
```

### 6.4 Implementation Phases

**Phase D4.1 — Email (lowest friction, Resend already in stack)**
- Send emails from engagement record (dossier follow-ups, confirmations)
- Receive emails via Resend inbound webhook → log on engagement timeline
- Template system for common messages (dossier intro, availability check)
- Cost: $0 (Resend free tier: 3,000 emails/mo)

**Phase D4.2 — WhatsApp (highest value for Spanish performing arts)**
- Workspace connects WhatsApp Business number via Meta Cloud API
- Outbound: send template messages from engagement record
- Inbound: webhook receives messages, matches to engagement by phone number
- Media: attachments stored in R2, linked to message record
- Cost: Meta per-message fees only (~€5/mo for Phase 0 volume)

**Phase D4.3 — Telegram (growing channel)**
- Workspace creates Telegram bot via BotFather
- Bot link embedded in dossiers and email signatures
- Inbound messages matched to engagement by Telegram user ID
- Outbound replies from engagement record
- Cost: $0 (Telegram Bot API is free)

**Phase D4.4 — Call logging (manual)**
- "Log call" button on engagement record
- Fields: date, duration, summary (text), outcome
- No VoIP integration — just structured notes
- Cost: $0

### 6.5 Multi-Tenant Considerations

| Concern | Solution |
|---------|----------|
| Each workspace needs its own WhatsApp number | Workspace settings: connect WhatsApp Business number via OAuth/token |
| Webhook receives events for all workspaces | Route by `phone_number_id` (WhatsApp) or `bot_token` (Telegram) |
| Message storage | All in Supabase `message` table, scoped by `workspace_id`, RLS enforced |
| Template management | Store templates per workspace in `message_template` table, submit to Meta for approval |
| Rate limits | WhatsApp: 80 msg/sec per number (more than enough). Telegram: 30 msg/sec per bot |

### 6.6 What NOT to Build

- **No unified inbox as primary view** — Hour is a CRM, not a help desk
- **No chatbot / auto-reply in Phase 0** — the performing arts context is personal, not transactional
- **No VoIP / phone integration** — too complex, too expensive, phone calls are logged manually
- **No marketing automation / bulk campaigns** — WhatsApp marketing messages are expensive and performing arts outreach is 1:1
- **No real-time chat widget** — Hour users don't have a website to embed a widget on (they have venues, not e-commerce)

---

## 7. Cost Summary

### Phase 0 (MaMeMi, 1 workspace, ~154 engagements)

| Item | Monthly cost |
|------|-------------|
| Resend (email) | $0 (free tier) |
| WhatsApp Cloud API (Meta fees) | ~€5 |
| Telegram Bot API | $0 |
| Infrastructure (already in stack) | $0 |
| **Total** | **~€5/month** |

### Phase 1 (15 workspaces, ~200 engagements each)

| Item | Monthly cost |
|------|-------------|
| Resend (email, ~10k/mo) | ~$20 |
| WhatsApp Cloud API (Meta fees, ~5k messages) | ~€80 |
| Telegram Bot API | $0 |
| Infrastructure (Workers + Supabase, already in stack) | $0 |
| **Total** | **~€100/month** |

This is passable to tenants: include WhatsApp costs in the subscription or bill as usage. At the 60 €/mo tier with 15 customers = €900/mo revenue vs ~€100/mo comms cost = healthy margin.

---

## 8. Competitive Advantage

None of Hour's direct competitors (see COMPETITION.md) offer integrated multichannel communication:

| Competitor | Email | WhatsApp | Telegram | Integrated timeline |
|-----------|-------|----------|----------|-------------------|
| Ares | No | Telegram notifications only (€10/mo add-on) | One-way only | No |
| Stagent | Basic | No | No | No |
| SystemOne | Basic | No | No | No |
| ABOSS | Basic | No | No | No |
| StageSwift | No | No | No | No |
| **Hour** | **Yes** | **Yes (bidirectional)** | **Yes (bidirectional)** | **Yes** |

This is a genuine differentiator. Every competitor forces users to switch to WhatsApp/email/Telegram externally and manually track conversations. Hour keeps the full communication history on the engagement record.

---

## 9. Key Takeaways

1. **WhatsApp Cloud API direct integration (no BSP)** is the right architecture. Hour already has the infrastructure (Cloudflare Workers, Supabase, R2). No reason to pay a middleman.

2. **Telegram Bot API** is free and simple. The limitation (user must message first) is manageable with bot links in dossiers.

3. **Contact timeline** is the right UX pattern for a CRM. Not a unified inbox. Folk's approach (WhatsApp + email on a contact timeline with AI follow-up detection) is the closest reference.

4. **Costs are negligible** at Phase 0 volumes (~€5/mo). At Phase 1, costs scale linearly and can be passed to tenants.

5. **Email first, WhatsApp second, Telegram third.** Resend is already in the stack. WhatsApp is the highest-value channel for the Spanish market. Telegram is free and growing.

6. **This is a real competitive moat.** No performing arts tool offers integrated multichannel communication tied to engagement records. The sector runs on WhatsApp + email + spreadsheets. Bringing it all into one timeline is the kind of feature that makes people switch.
