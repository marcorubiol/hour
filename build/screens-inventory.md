# Hour — Screens inventory (design checklist)

> What: every screen in the app, so a full design pass has a complete work-list.
> Source: SvelteKit routes (`apps/web/src/routes`) + dialogs/overlays (`apps/web/src/lib/components`),
> read from the repo 2026-07-14. Re-derive with `find apps/web/src/routes -name +page.svelte`.
> URLs updated 2026-07-16 (ADR-067): lens routes are space-less; the space segment
> appears only on entity URLs, as a machine short-id (or its granted alias, inbound-only).
> Model these screens against `build/structure-model.md` (lens vs module vs entity edit surface).
> Each list item is a design unit — tick it when its visual design is done.

## Product screens — with URL

**Shell + home — Desk (the now)**
- [ ] `/h` — Home: the **hall** (time-aware greeting + date + "posa'm al dia" door → `/h/desk`, Marco's design 2026-07-16). The cross-space digest died with ADR-068 — Desk IS the catch-up surface.
- [ ] `/h/desk` — full Desk view, uncapped.
- [ ] `/h/[workspace]` — Space portada (editable entity: domain · city · logo · description).

**Lenses** — three concern-lenses, reached by ⌘K (ADR-065). Desk (the home) is a cross-concern digest, not a lens — see Shell + home above.

- [ ] **Calendar** — month grid / planning / conflict-detection. `/h/calendar`.
- [ ] **Contacts** — your booking network (people AND organizations): engagement table + search/filter (**+ Comms** later, as a per-contact timeline). `/h/contacts`. Mobile-first (ADR-015).
- [ ] **Money** — fees + invoices + totals. `/h/money`. Gated by `read:money`.

**Entity detail** (under `/h/[workspace]/`)
- [ ] `/project/[slug]` — Project detail (show content + its lines + scoped lenses, ADR-063).
- [ ] `/project/[slug]/line/[line]` — Line detail (the module composition).
- [ ] `/performance/[slug]` — Performance detail (the gig).
- [ ] `/performance/[slug]/roadsheet` — Road sheet (operator, role-filtered, public-links UI).
- [ ] `/engagement/[slug]` — Engagement detail (a conversation).
- [ ] `/person/[slug]` — Person detail (contact card).

**System**
- [ ] `/settings` — Settings (multi-panel: account, Master View, future role management).

## Auth / public / system

- [ ] `/login` — login (email + password; TOTP 2FA slot).
- [ ] `/offline` — PWA offline fallback.
- [ ] `/public/roadsheet/[token]` — public road sheet (external, no account). The only public face — distinct visual language. Mobile-critical.
- `/` — root gate (redirect to `/h` or `/login`; not a design screen).

## Screens without URL

**Dialogs / modals**
- [ ] ⌘K Command Palette — the whole navigation surface. Big piece.
- [ ] New space (CreateWorkspaceDialog)
- [ ] New project (CreateProjectDialog)
- [ ] New line — template picker (tour / booking / creation / press / fair / blank)
- [ ] Edit space (EditWorkspaceDialog, incl. Web address / alias request — ADR-067)
- [ ] Alias review block (Settings › Workspaces, platform admin — ADR-067)
- [ ] New performance (PerformanceCreateDialog, from Calendar)
- [ ] Edit performance (schedule + venue + status, in performance detail)
- [ ] Add contact (multi-space, in Contacts)
- [ ] Add to project (in person detail)
- [ ] Fee editor (in Money)
- [ ] New invoice (in Money)
- [ ] Calendar feed (subscribe / ICS, in Calendar)

**Line modules** — rendered inside `/project/[slug]/line/[line]`, each its own design surface
- [ ] Calendar module
- [ ] Contacts module (the line's booking conversations — Contacts lens scoped)
- [ ] Money module
- [ ] Notes module
- [ ] Materials module
- [ ] Team module (cast + crew of the line)
- [ ] Road sheets module

**Overlays / menus**
- [ ] Account menu (topbar, with theme accordion)
- [ ] Toasts

## Cross-cutting (multiply the real work)

- [ ] **States** per lens/list: empty · loading · error · offline. Phase 0.3 gate; offline still pending.
- [ ] **Mobile**: Contacts mobile-first (ADR-015); Desk responsive pending (Phase 0.4); public road sheet mobile-critical.
- [ ] **Light + dark**: both themes are contracts (ADR-059). Every screen designed for both.

## Not counted (dev-only, not product)
`/playground` (component gallery — useful for the design system, not a product screen) · `/dev/sentry-test`.
