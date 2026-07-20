# Revisión adversarial de la migración de comms — 2026-07-20

> 4 lentes en paralelo sobre `build/migrations/2026-07-20_comms_threads_and_membership.sql`
> (seguridad · corrección SQL · fidelidad al modelo · seguridad de migración).
> 32 hallazgos en bruto; se solapan mucho entre lentes.
> **La migración NO se ha aplicado a ninguna base.**

## 1. [BLOCKER] `can_read_thread()` returns true for a non-member of the container: the general-thread branch checks workspace membership, not container membership, so every general thread of every project / line / performance / conversation is readable by ANY accepted workspace member.

**Evidencia:** Migration line 393: `OR (t.is_general AND public.is_workspace_member(t.workspace_id))`. `is_workspace_member` (build/rls-policies.sql:64-73) only tests `workspace_membership.user_id = auth.uid() AND accepted_at IS NOT NULL` — it has no container argument. The thread's `project_id / line_id / performance_id / conversation_id` (migration lines 204-207) are never consulted. The design says the opposite: migration line 243 (`Audience = the container's members, full stop`) and _notes/spec-access-comms-decisions.md §2 ("the general thread ... its audience is exactly the container's members"). Breaking query, run as a workspace member with NO project_membership row for project P: `SELECT m.body FROM message m JOIN thread t ON t.id=m.thread_id WHERE t.is_general AND t.project_id='<P>'` — returns rows. Same for a performance-level general thread. Via `thread_participant_select` (line 455-457, same predicate) the same user also gets the participant roster of those threads, i.e. which outside contacts are on the gig. Note this is strictly wider than the existing model: `has_permission` (rls-policies.sql:98-142) gates project data per project_membership, and a plain workspace `member` gets nothing there.

**Arreglo:** Replace the branch with a container-membership test built on the same chain the facet branch uses, e.g. `OR (t.is_general AND EXISTS (SELECT 1 FROM public.container_chain(t.workspace_id,t.project_id,t.line_id,t.performance_id) c JOIN public.membership m ON m.user_id=auth.uid() AND m.revoked_at IS NULL AND (m.ends_at IS NULL OR m.ends_at>now()) AND ((c.level='workspace' AND m.workspace_id=c.id AND m.project_id IS NULL AND m.line_id IS NULL AND m.performance_id IS NULL) OR (c.level='project' AND m.project_id=c.id) OR (c.level='line' AND m.line_id=c.id) OR (c.level='performance' AND m.performance_id=c.id))))`, plus the owner/admin bypass. `is_workspace_member` is only correct for a thread whose four parent FKs are all NULL.

## 2. [BLOCKER] `message_insert` never binds `author_person_id` to the caller, so any user who can read a thread can post a message attributed to any person in the database — including the venue director or the promoter, in the `diners` thread.

**Evidencia:** Migration lines 467-472: `WITH CHECK (public.can_read_thread(thread_id) AND workspace_id = current_workspace_id())`. `message.author_person_id` (line 276) is `NOT NULL` but unconstrained, and `author_user_id` (line 277) is nullable, so `INSERT INTO message (thread_id, workspace_id, author_person_id, author_user_id, body) VALUES ('<readable thread>', current_workspace_id(), '<any person uuid>', NULL, 'confirmo el caché de 4.500€')` passes the policy. The house pattern does bind the author: `person_note_insert` (build/rls-policies.sql:621-627) has `AND author_id = auth.uid()` in its WITH CHECK, and `person_note` additionally carries the `guard_immutable_author` trigger (build/schema.sql:864-876). `message` gets neither.

**Arreglo:** Add to the WITH CHECK: `AND author_user_id = auth.uid() AND author_person_id = (SELECT person_id FROM public.user_profile WHERE user_id = auth.uid())`. That column is the constrained user↔person bridge (build/migrations/2026-07-18_user_profile_person_id.sql, UNIQUE on person_id). Guest (`invitat`) writes have no `auth.uid()` at all and must land through their own signed-link RPC, not this policy.

## 3. [BLOCKER] Facet threads anchored to a `conversation` are unreadable by anyone except workspace owner/admin: `container_chain()` has no conversation parameter, so the chain collapses to workspace-only.

**Evidencia:** `thread.conversation_id` is a legal parent (migration L207, L228-233), but `container_chain(p_workspace, p_project, p_line, p_performance)` (L310-311) takes no conversation argument, and `can_read_thread` passes only `t.workspace_id, t.project_id, t.line_id, t.performance_id` (L396). For a row `thread(conversation_id=C, facet_key='materials')` the other three parents are NULL (CHECK `thread_at_most_one_parent`), so the CTE returns a single `('workspace', ws)` pair; `has_facet`'s `JOIN public.facet_level fl ON fl.level = c.level` (L366-368) then finds no row, because `materials` is only registered at project/line/performance (L85-87). Result: `SELECT * FROM message WHERE thread_id = <that thread>` returns 0 rows for every plain member. `conversation` does carry `project_id NOT NULL` and `workspace_id NOT NULL` (schema.sql:401-410, renamed from `engagement` by 2026-07-17_rename_engagement_to_conversation.sql:101), so the chain is derivable — it just isn't derived.

**Arreglo:** Add `p_conversation uuid` to `container_chain` and resolve project/line/workspace from `public.conversation` in the same coalesce ladder (conversation is not itself a `container_level`, so it contributes ancestors only); pass `t.conversation_id` from `can_read_thread`. Alternatively forbid `facet_key IS NOT NULL AND conversation_id IS NOT NULL` with a CHECK until it is supported.

## 4. [BLOCKER] The "explicitly invited" branch of `can_read_thread` is dead code for every logged-in user: it joins `membership.person_id`, which the backfill leaves NULL, while the real user↔person bridge in this database is `user_profile.person_id`.

**Evidencia:** L384-391 requires `m.person_id = tp.person_id AND m.user_id = auth.uid()`. The backfill (L408-417) inserts no `person_id` at all — deliberately, per the comment at L404-406 and `COMMENT ON COLUMN public.membership.person_id` (L158-159). So for every existing user `m.person_id` is NULL and `NULL = tp.person_id` is never true. Concretely: add row `thread_participant(thread_id=T, person_id=P)` for a free thread (`label` set, `facet_key` NULL, `is_general` false), where P is user U's person; `SELECT public.can_read_thread('T')` as U returns false — the general branch (L393) is skipped because `is_general` is false and the facet branch (L395) because `facet_key` is NULL. Free threads are therefore readable by nobody. The bridge that does exist is `user_profile.person_id` (2026-07-18_user_profile_person_id.sql:29, with UNIQUE index `user_profile_person_id_key`).

**Arreglo:** Resolve the caller's person through `user_profile` (`EXISTS (SELECT 1 FROM thread_participant tp JOIN user_profile up ON up.person_id = tp.person_id WHERE tp.thread_id = t.id AND up.id = auth.uid())`), optionally keeping the `membership` path as an additional route, and gate on the membership's `revoked_at`/`ends_at` separately.

## 5. [BLOCKER] The invitat cannot exist: every read/write path is keyed on auth.uid(), so a membership with user_id IS NULL — the schema's own definition of an invitat — grants nothing anywhere.

**Evidencia:** has_facet lines 342 and 356 (`m.user_id = auth.uid()`); can_read_thread line 387 (`m.user_id = auth.uid()`); all policies are `TO authenticated` (434-477). The CHECK membership_guest_must_expire (149-151) and the COMMENT at 155 declare `user_id NULL = an invitat`, yet no function or policy ever resolves a membership by person without a user_id. Concrete: insert a membership (person_id=venue technician, user_id NULL, ends_at=+3 weeks) + membership_facet('tecnica','view'); nothing in the migration lets that person read or write a single row. ADR-085 §3/§4 requires signed-link read AND write. §9 'what stage 2 owes' (481-489) does not list the guest access path.

**Arreglo:** Either add the signed-link resolution path (a SECURITY DEFINER RPC that takes the token, resolves membership.id, and returns threads/messages — with has_facet/can_read_thread taking an explicit membership context instead of auth.uid()), or state in the header that stage 1 ships the invitat data model with no guest access path and add it to §9.

## 6. [BLOCKER] After this migration no authenticated user can read any free thread: the participant branch requires a membership row carrying BOTH person_id and user_id, and the backfill leaves person_id NULL on every row it creates.

**Evidencia:** can_read_thread lines 384-391 joins `membership m ON m.person_id = tp.person_id AND m.user_id = auth.uid()`. The backfill (408-417) inserts no person_id, and the COMMENT at 158-159 says person_id stays NULL until stage 2. A free thread's only audience is thread_participant (a label-only thread fails both the is_general and facet_key branches, 393-396). Concrete: `INSERT INTO thread (workspace_id, project_id, label) …; INSERT INTO thread_participant (thread_id, person_id) VALUES (t, marco_person);` then `SELECT * FROM thread WHERE id = t` as Marco returns 0 rows — including for the workspace owner, since the owner/admin bypass lives only inside has_facet and never runs for a label thread.

**Arreglo:** Resolve the participant to the caller by person identity independent of the stage-1 backfill (e.g. via user_profile.person_id, which 2026-07-18_user_profile_person_id.sql already added), and/or give can_read_thread the same owner/admin bypass the facet branch has.

## 7. [BLOCKER] A general thread's audience is every workspace member, not the container's members — the schema permits exactly what the amendment forbids.

**Evidencia:** can_read_thread line 393: `OR (t.is_general AND public.is_workspace_member(t.workspace_id))` — the container FKs (project_id/line_id/performance_id/conversation_id) are ignored. Digest §2 and ADR-082 amendment line 2091: «El hilo general … su audiencia es exactamente los miembros del contenedor». Concrete: the general thread of a gig the caller has no membership on at any level is readable by any accepted workspace member, so a performer with no membership on that performance reads the gig's own thread.

**Arreglo:** Resolve the general thread's audience through container_chain — a membership row (revoked_at IS NULL, not expired) at any level on the thread's chain — keeping the owner/admin bypass explicit, instead of is_workspace_member on the workspace_id.

## 8. [REAL] `message_update` leaves `thread_id`, `workspace_id` and `author_person_id` mutable, so an author can relocate their own message into a thread and a workspace they cannot read, and can reattribute it to someone else after the fact.

**Evidencia:** Migration lines 474-477: `USING (deleted_at IS NULL AND author_user_id = auth.uid()) WITH CHECK (author_user_id = auth.uid())`. Nothing else is checked, and unlike every comparable table `message` has no `guard_immutable_workspace_id` trigger (build/schema.sql:826-838 lists the 13 tables that do; build/migrations/2026-07-17_task_entity.sql:99 and 2026-07-18_availability_block.sql:89 attach it to the newer ones). Breaking statement: `UPDATE message SET thread_id='<uuid of a thread in another workspace>', workspace_id='<that workspace>' WHERE id='<my own message>'` — USING passes, WITH CHECK passes (author_user_id unchanged). The victim workspace now shows an authentic-looking message in a thread the attacker was never in. Note the asymmetry with `message_insert` (line 471), which does pin `workspace_id = current_workspace_id()`.

**Arreglo:** Add `CREATE TRIGGER message_guard_ws BEFORE UPDATE ON public.message FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();` plus a guard on `thread_id` and `author_person_id`, and/or narrow the WITH CHECK to `author_user_id = auth.uid() AND thread_id = (SELECT thread_id FROM public.message WHERE id = message.id)`. Simplest is the trigger, matching the house pattern.

## 9. [REAL] The explicitly-invited branch of `can_read_thread()` uses `membership` as the user↔person bridge with no workspace scoping, so a membership minted in workspace A grants reads on threads in workspace B.

**Evidencia:** Migration lines 384-391: `JOIN public.membership m ON m.person_id = tp.person_id AND m.user_id = auth.uid() ...` — the join has no relation to `t.workspace_id` or to the thread's container. `membership.person_id` (line 123) is free-form and `person` is global with no workspace_id (build/schema.sql:254-275), so a row `membership(workspace_id=A, user_id=<attacker>, person_id=P)` — a normal act inside workspace A — makes every thread in workspace B that has `thread_participant(person_id=P)` readable: `SELECT body FROM message WHERE thread_id='<B thread with P as participant>'` returns rows. There is no uniqueness on `(user_id, person_id)` anywhere in this table; the constrained bridge already exists elsewhere — `user_profile.person_id` with `CREATE UNIQUE INDEX user_profile_person_id_key` (build/migrations/2026-07-18_user_profile_person_id.sql). Not yet exploitable through PostgREST because stage 1 ships no INSERT policy on `membership` (migration line 486 defers it), so today it is only reachable via service_role — but the hole is baked into the function the stage-2 RPC will sit on top of. Secondary effect of the same join: backfilled rows have `person_id` NULL by design (lines 158-159, 404-406), so today this branch matches nobody and free threads are unreadable even by their participants.

**Arreglo:** Resolve the caller's person from `user_profile.person_id`, not from `membership`: `EXISTS (SELECT 1 FROM public.thread_participant tp JOIN public.user_profile up ON up.person_id = tp.person_id AND up.user_id = auth.uid() WHERE tp.thread_id = t.id)`. If a live-membership condition is also wanted, add it as an extra predicate scoped to `t.workspace_id`, not as the identity lookup.

## 10. [REAL] `has_facet()` never checks `accepted_at`, while the backfill copies unaccepted workspace invitations, so a user who was invited to a workspace and never accepted gets facet-derived reads that `is_workspace_member` and `has_permission` both refuse them.

**Evidencia:** Migration lines 352-359: the membership join tests `revoked_at IS NULL`, `ends_at`, `user_id` and the container match — no `accepted_at`. The backfill at lines 408-412 is `FROM public.workspace_membership wm` with no WHERE clause, and `workspace_membership.accepted_at` is nullable (build/schema.sql:216), so pending invites become live `membership` rows. Every other gate in the codebase requires acceptance: `is_workspace_member` (rls-policies.sql:70), `current_workspace_role` (rls-policies.sql:58), `has_permission` bypass path (rls-policies.sql:109). Result: for a pending invitee, `is_workspace_member(ws)` is false but `has_facet(ws,NULL,NULL,NULL,'diners','view')` is true as soon as one `membership_facet` row exists for them, and `SELECT body FROM message m JOIN thread t ON t.id=m.thread_id WHERE t.facet_key='diners'` returns the money thread.

**Arreglo:** Add `AND m.accepted_at IS NOT NULL` to the join at line 352-359 (guests will need their own branch since they never accept via a login), and add `WHERE wm.accepted_at IS NOT NULL` to the backfill at line 412 — or carry acceptance forward and let the function enforce it.

## 11. [REAL] `container_chain()` has no `conversation` branch, so for a thread hung off a conversation the chain collapses to the workspace alone — the conversation's project/line grants never apply, and only the widest grant does.

**Evidencia:** `thread.conversation_id` is one of the four legal parents (migration line 207, and it is in `thread_at_most_one_parent`, lines 228-233), but `container_chain` takes only `(p_workspace, p_project, p_line, p_performance)` (lines 310-312) and `can_read_thread` passes only those four (lines 395-396) — `t.conversation_id` is dropped on the floor. `conversation.project_id` is `NOT NULL` (build/schema.sql:404, table renamed from `engagement` by build/migrations/2026-07-17_rename_engagement_to_conversation.sql:101), so the project is knowable and is being discarded. Concrete consequence for the money facet: a `diners` thread on a difusión conversation — where the fee is actually negotiated — resolves its chain to `{workspace}` only, so it is invisible to someone granted `diners` on that project (false deny) and visible to anyone granted `diners` at workspace level across every project (the union rule applied at the widest possible node). `container_level` has no `conversation` value either (lines 32-34), so `facet_level` cannot describe this case at all.

**Arreglo:** Either give `container_chain` a fifth parameter that resolves `conversation_id → project_id/workspace_id` (mirroring the denormalised-FK reads at lines 317-324), or, if a conversation is deliberately not a container, forbid `facet_key` threads on `conversation_id` with a CHECK so the case cannot silently resolve to workspace-only.

## 12. [REAL] `membership_select` + `membership_facet_select` publish the entire permission matrix of a workspace — including who holds `diners` and at which project/line/performance — to every accepted member, whatever their role.

**Evidencia:** Migration lines 439-441 `USING (public.is_workspace_member(workspace_id))` and 443-448 (same test via the parent membership). `is_workspace_member` (rls-policies.sql:64-73) does not look at `workspace_membership.role`, which ranges over `owner | admin | member | viewer | guest` (build/schema.sql:227). So a `viewer` runs `SELECT m.person_id, m.project_id, m.line_id, m.performance_id, m.preset, m.ends_at, m.invited_by, mf.facet_key, mf.verb FROM membership m JOIN membership_facet mf ON mf.membership_id = m.id` and gets the full roster of every container in the workspace, including guest (`user_id IS NULL`) invitations to gigs and projects they have no access to, and the complete list of who can read money. _notes/spec-access-comms-decisions.md §3 requires guests be "always visible in 'who enters and why'" but never scopes that to the whole workspace, and §5 places the roster "behind a door".

**Arreglo:** Scope the SELECT to what the caller can reach rather than to the workspace: allow rows where the caller is the subject (`user_id = auth.uid()`), plus rows on a container the caller is a member of, plus the owner/admin bypass already coded at lines 339-348. At minimum restrict `membership_facet_select` to the caller's own memberships plus owner/admin, since it is the row that names who reads `diners`.

## 13. [REAL] `message_insert` does not constrain `author_person_id`, so any authenticated thread reader can post a message attributed to any other person.

**Evidencia:** L467-472: `WITH CHECK (public.can_read_thread(thread_id) AND workspace_id = current_workspace_id())`. `author_person_id` is `NOT NULL REFERENCES public.person` (L276) but never checked, and no BEFORE INSERT trigger sets it. Breaking statement: `INSERT INTO public.message (thread_id, workspace_id, author_person_id, body) VALUES ('<thread I can read>', current_workspace_id(), '<the promoter''s person id>', 'accepto el caché');` succeeds via PostgREST. `author_user_id` also stays NULL, which additionally makes the message uneditable/undeletable by its real author, since `message_update` (L474-477) keys on `author_user_id = auth.uid()`.

**Arreglo:** Force authorship server-side: default/trigger `author_user_id := auth.uid()` and derive `author_person_id` from `user_profile.person_id` for the caller, with a `WITH CHECK` that both match the caller (guest writes then need their own signed-link path, not the `authenticated` role).

## 14. [REAL] `has_facet` never checks `membership.accepted_at`, diverging from every other access helper in the house pattern — a pending, never-accepted invitation grants facet access.

**Evidencia:** The owner/admin bypass inside `has_facet` does check it (L342 `AND wm.accepted_at IS NOT NULL`), but the membership branch (L352-359) filters only on `revoked_at IS NULL` and `ends_at`. `membership.accepted_at` exists (L132). Every existing helper requires acceptance: `is_workspace_member` (rls-policies.sql:64-73), `current_workspace_role` (rls-policies.sql:53-59), `has_permission` bypass (rls-policies.sql:98-113). The backfill copies `wm.accepted_at` verbatim with no WHERE (L408-412), so pending workspace invitations become live `membership` rows.

**Arreglo:** Add `AND m.accepted_at IS NOT NULL` to the membership join in `has_facet`, or state explicitly why an invitat (who by definition never accepts) needs the exemption and encode that as `(m.accepted_at IS NOT NULL OR m.user_id IS NULL)`.

## 15. [REAL] `membership` and `thread` carry `updated_at` columns with no `set_updated_at` trigger, so the column silently freezes at insert time.

**Evidencia:** `membership.updated_at` (L131) and `thread.updated_at` (L224) both `NOT NULL DEFAULT now()`. The shared trigger function is `set_updated_at()` (schema.sql:102) and every other table with the column wires it (schema.sql:679-695: workspace, user_profile, workspace_membership, workspace_role, person, venue, project, project_membership, line, engagement, show, date, person_note, invoice, invoice_line, payment, expense). No `CREATE TRIGGER` appears anywhere in this migration.

**Arreglo:** Add `CREATE TRIGGER membership_set_updated_at BEFORE UPDATE ON public.membership FOR EACH ROW EXECUTE FUNCTION set_updated_at();` and the same for `public.thread`.

## 16. [REAL] After this migration no member sees any facet thread: `membership_facet` gets zero rows and there is no path to write them.

**Evidencia:** The backfill (L408-417) inserts into `membership` only — nothing inserts into `membership_facet`. `has_facet`'s non-bypass branch requires a `membership_facet` join (L360-363), so it returns false for every non owner/admin. `membership_facet` also has no INSERT policy (only `membership_facet_select`, L443-448), and §9 (L487-488) defers the granting RPC. So `thread_select`/`message_select` yield nothing for a plain `member` for every facet thread, and §9 does not list a facet backfill among what stage 2 owes.

**Arreglo:** Either expand the four presets into `membership_facet` rows as part of the backfill (the `preset` column already records the provenance the backfill assigns at L410 and L415), or add an explicit line to §9 saying the comms layer is inert for members until the granting RPC ships, so it is not mistaken for a bug at test time.

## 17. [REAL] Threads hanging off a conversation lose their project and line ancestors, breaking the union rule for exactly the container that thread.conversation_id exists to serve.

**Evidencia:** thread.conversation_id is declared at line 207, but container_chain (310-330) has no conversation parameter and can_read_thread passes only `t.workspace_id, t.project_id, t.line_id, t.performance_id` (396) — all three container FKs are NULL on a conversation thread (CHECK thread_at_most_one_parent, 228-233). conversation.project_id is NOT NULL (schema.sql 404, table renamed 2026-07-17). Concrete: thread(conversation_id=C, facet_key='diners') where C belongs to project P; a user holding diners·view at project P gets has_facet → false. Worse for 'materials'/'tecnica'/'logistica': they have no workspace-level row in facet_level (85-95), so such a thread is readable by nobody but owner/admin, at any grant.

**Arreglo:** Add p_conversation to container_chain and derive project_id/workspace_id from conversation, or forbid facet threads on conversations with a CHECK and document why.

## 18. [REAL] has_facet honours memberships that were never accepted, unlike every other membership check in the codebase — so a pending invitation already carries permissions.

**Evidencia:** has_facet's normal path (349-369) filters on revoked_at, ends_at and user_id but never on accepted_at; the bypass path immediately above (340-347) does require `wm.accepted_at IS NOT NULL`, as do is_workspace_member (rls-policies.sql 64-73) and has_permission (98-111). The COMMENT at 372-373 claims the bypass is 'identical to has_permission, on purpose: one bypass rule', while the two halves of the same function disagree on acceptance. Concrete: invite X to the workspace, grant diners·view at project level, X never accepts → is_workspace_member false, has_permission false, has_facet true.

**Arreglo:** Add `AND m.accepted_at IS NOT NULL` to the membership join in has_facet, and backfill accepted_at for project_membership rows (which have no such column) with a deliberate value rather than NULL.

## 19. [REAL] The backfill mints memberships whose preset is provenance for grants that do not exist, and flattens viewer/guest into 'equip' — the roster answers ADR-082 §4's hard question with a lie.

**Evidencia:** Lines 408-417 insert into membership only; no membership_facet rows are ever written. The COMMENT at 156-157 defines preset as 'which preset they were expanded from', and §4's header (173-177) states presets are 'EXPANDED into rows at grant time rather than resolved at read time'. So every backfilled row shows preset='direccio' or 'equip' with zero effective facets. The CASE at 410 also maps membership_role 'viewer' and 'guest' (schema.sql 117) to 'equip', above the ladder's floor 'minim' (digest §1, ADR-082 amendment line 2099).

**Arreglo:** Either expand each preset into membership_facet rows in the same backfill, or set preset NULL with a comment that stage-1 rows carry no grants; map viewer/guest to 'minim' rather than 'equip'.

## 20. [REAL] Nothing enforces the facet×level table at write time, so the stated safety gain of per-level facets is not actually bought — the illegal grant is merely inert.

**Evidencia:** membership_facet (179-188) references facet(key) only, never facet_level; thread (200-237) likewise references facet(key) at line 219 with no level constraint. `INSERT INTO membership_facet VALUES (<a workspace-level membership>, 'full-de-ruta', 'edit')` and `INSERT INTO thread (workspace_id, facet_key) VALUES (w, 'full-de-ruta')` both succeed. Digest §2 line 65-66 and ADR-082 amendment line 2097 justify the whole per-level design as: «no puedes conceder Full de ruta a nivel espai … porque la fila no está ahí para concederla». has_facet (366-368) makes such a grant do nothing, but the roster ('effective permissions and where they come from') will render it as a granted permission.

**Arreglo:** Add a trigger (or a level column on membership_facet with a composite FK to facet_level) rejecting a grant/thread whose facet has no row at that container's level; a trigger keeps the level map data-only, so moving a facet stays one UPDATE.

## 21. [REAL] Free threads (label set) are unreadable by every authenticated user, including workspace owners — the feature ships dead until stage 2 populates membership.person_id.

**Evidencia:** can_read_thread (migration lines 384–391) reaches participants only via `JOIN public.membership m ON m.person_id = tp.person_id AND m.user_id = auth.uid()`. The backfill (lines 408–417) inserts every membership row with person_id NULL (deliberately, per the comment at 158–159), so that EXISTS can never be true. A free thread has is_general=false and facet_key NULL (enforced by thread_kind_exactly_one, line 234), so the other two branches at 393 and 395 are false too, and the owner/admin bypass lives inside has_facet (339–348) which is never reached. Breaking query: `INSERT INTO thread (workspace_id, label) VALUES (:ws,'x'); SELECT * FROM thread WHERE label='x';` returns 0 rows for the workspace owner. Note user_profile.person_id already exists as the sanctioned user↔person bridge (2026-07-18_user_profile_person_id.sql:28) — but that migration's own header says it is NOT applied to any live DB.

**Arreglo:** Either resolve the participant path through user_profile.person_id (`JOIN user_profile up ON up.person_id = tp.person_id AND up.id = auth.uid()`) instead of membership.person_id, or add the workspace owner/admin bypass to can_read_thread so free threads are not invisible in stage 1. If neither, state in §9 that no thread UI can ship before the stage-2 person link.

## 22. [REAL] The general-thread branch grants every workspace member read access to the general thread of every project, line and performance in the workspace — wider than the design, which says the audience is the container's members.

**Evidencia:** Migration line 393: `OR (t.is_general AND public.is_workspace_member(t.workspace_id))`. is_workspace_member (rls-policies.sql:64) only checks an accepted row in workspace_membership for that workspace — it ignores t.project_id / t.line_id / t.performance_id entirely. _notes/spec-access-comms-decisions.md §2 states: "`General` is NOT in the table. It is membership in the container: the general thread always exists and its audience is exactly the container's members." Breaking case: a `viewer` in the workspace with no membership row on project P reads the general thread of P, and of every gig under it.

**Arreglo:** Replace with a container-membership check over container_chain — an EXISTS on public.membership joined to container_chain(t.workspace_id, t.project_id, t.line_id, t.performance_id) with revoked_at IS NULL AND (ends_at IS NULL OR ends_at > now()), plus the workspace owner/admin bypass. The comment on line 392 already describes this intent.

## 23. [REAL] Threads hung off a conversation lose their project/line ancestry: container_chain has no conversation parameter, so a conversation-level facet thread resolves against workspace-level facets only.

**Evidencia:** thread.conversation_id exists (line 207) and thread_at_most_one_parent accepts it (line 232), but container_level has only 'workspace','project','line','performance' (lines 32–34) and container_chain takes four params, none of them a conversation (lines 310–312). can_read_thread passes t.project_id/t.line_id/t.performance_id — all NULL for a conversation thread — so the chain collapses to {workspace} (line 329). facet_level has only `converses` and `diners` at 'workspace' (lines 80–101), so a `materials` or `tecnica` thread on a conversation fails the facet_level join at 366–368 and is readable by nobody except workspace owner/admin via the bypass at 339. The data to fix it exists: conversation carries project_id and line_id (conversation_project_id_fkey / conversation_line_id_fkey, 2026-07-17_rename_engagement_to_conversation.sql:111,113).

**Arreglo:** Add a p_conversation param to container_chain that coalesces project_id/line_id from public.conversation, and have can_read_thread pass t.conversation_id — or drop thread.conversation_id from stage 1 and add it with the chain support together.

## 24. [REAL] message_insert lets any thread reader forge the author, and message_update lets an author move a message to another thread or rewrite created_at — both against the house immutability pattern.

**Evidencia:** message_insert (lines 467–472) checks only can_read_thread(thread_id) AND workspace_id = current_workspace_id(); nothing constrains author_person_id (NOT NULL, line 276) or author_user_id, so `INSERT INTO message (thread_id, workspace_id, author_person_id, body) VALUES (:t, current_workspace_id(), :someone_elses_person_id, 'x')` succeeds and is attributed to that person — in a table whose own COMMENT (285–286) calls attribution the point. message_update (474–477) has USING/WITH CHECK on author_user_id only, leaving thread_id, workspace_id, author_person_id, created_at and deleted_at freely writable by the author. schema.sql:864/876 already ships guard_immutable_author() with a BEFORE UPDATE trigger on person_note for exactly this.

**Arreglo:** In message_insert add `AND author_user_id = auth.uid()` and bind author_person_id to the caller (via user_profile.person_id). Add `message_guard_author BEFORE UPDATE ON public.message EXECUTE FUNCTION guard_immutable_author()` and a guard on thread_id/created_at, mirroring person_note.

## 25. [REAL] membership.updated_at and thread.updated_at will never change: no set_updated_at trigger, and no guard_immutable_workspace_id, breaking the convention every other workspace-scoped table follows.

**Evidencia:** membership.updated_at declared at line 131 and thread.updated_at at line 224; the migration creates no trigger at all (no CREATE TRIGGER anywhere in the file). Compare 2026-07-17_task_entity.sql:98–99 (`task_set_updated_at` + `task_guard_ws`) and 2026-07-18_availability_block.sql:88–89 — same shape of table, both triggers present. set_updated_at() and guard_immutable_workspace_id() already exist (schema.sql:102, 814).

**Arreglo:** Add `CREATE TRIGGER membership_set_updated_at BEFORE UPDATE ON public.membership FOR EACH ROW EXECUTE FUNCTION set_updated_at();` and the same for thread, plus `*_guard_ws` triggers on membership, thread and message.

## 26. [REAL] The backfill is not idempotent: a second run aborts the whole migration on a unique violation, and after any revocation it silently duplicates rows.

**Evidencia:** The two INSERTs (lines 408–417) have no ON CONFLICT and no NOT EXISTS guard. Re-running raises 23505 on membership_unique_ws (line 161). Worse, that index is partial — `WHERE … revoked_at IS NULL` — so any membership row that has been revoked no longer blocks a re-insert, and a re-run produces a second live row for the same (workspace_id, user_id), silently resurrecting revoked access.

**Arreglo:** Guard both INSERTs with `WHERE NOT EXISTS (SELECT 1 FROM public.membership m WHERE m.workspace_id = wm.workspace_id AND m.user_id = wm.user_id AND m.project_id IS NULL AND m.line_id IS NULL AND m.performance_id IS NULL)` (and the project analogue), so re-running is a no-op regardless of revoked_at.

## 27. [NIT] `container_chain()` is SECURITY DEFINER, ignores `auth.uid()` entirely and is left executable by PUBLIC, giving `anon` a tenancy-structure oracle.

**Evidencia:** Migration line 330 ends the function with `SECURITY DEFINER SET search_path = public, extensions, pg_temp` and no `REVOKE ... FROM PUBLIC, anon` / `GRANT EXECUTE ... TO authenticated` — the pattern used for every other new SECURITY DEFINER function in this repo (build/migrations/2026-07-17_task_entity.sql:241-242, 2026-07-18_availability_block.sql:192-193, 226-227). The function body contains no `auth.uid()` reference at all, so `SELECT * FROM container_chain(NULL,NULL,NULL,'<performance uuid>')` called unauthenticated via PostgREST returns that performance's line, project and workspace ids. The existing helpers left ungranted (`has_permission`, `is_workspace_member`) all return a boolean gated on `auth.uid()`, so this is a different exposure, not the same precedent. Low severity: it needs a valid uuid, and uuid_generate_v7 ids are not guessable in bulk. `search_path` is correctly pinned on all three new functions (lines 330, 370, 399) and there is no dynamic SQL anywhere.

**Arreglo:** `REVOKE ALL ON FUNCTION public.container_chain(uuid,uuid,uuid,uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.container_chain(uuid,uuid,uuid,uuid) TO authenticated;` and the same for `has_facet` and `can_read_thread`.

## 28. [NIT] The partial UNIQUE indexes key on `coalesce(user_id, person_id)`, which does not prevent two live memberships for the same human at the same container.

**Evidencia:** L161-165. A guest row `(workspace_id=W, person_id=P, user_id=NULL, ends_at=…)` keys on P; once that person gets a login the operator row `(workspace_id=W, user_id=U, person_id=P)` keys on U. Both satisfy `membership_unique_ws` simultaneously. Since effective access is the union across rows (table comment, L155), the expired guest row's grants and the operator row's grants coexist, and revoking one leaves the other.

**Arreglo:** Either key the indexes on `person_id` once stage 2 makes it NOT NULL, or add a stage-2 check that a container has at most one non-revoked membership per resolved person.

## 29. [NIT] `message.workspace_id` is not tied to `thread.workspace_id`, so a user in two workspaces can insert a message whose workspace tag disagrees with its thread.

**Evidencia:** `message.workspace_id` (L271) is an independent FK; `message_insert` (L467-472) requires `workspace_id = current_workspace_id()` while `can_read_thread(thread_id)` is evaluated against the thread's own workspace. A user who is a member of workspaces A and B, with `current_workspace_id() = B`, can insert a message on a thread belonging to A carrying `workspace_id = B`. Any workspace-scoped aggregate over `message` then miscounts.

**Arreglo:** Add `AND workspace_id = (SELECT t.workspace_id FROM public.thread t WHERE t.id = thread_id)` to the WITH CHECK, or drop `message.workspace_id` and reach it through `thread`.

## 30. [NIT] The thread comments describe a design that was replaced by is_general and point at an object that does not exist, in the file that is the model's written record.

**Evidencia:** Line 209-211 says «A facet thread is gated by the facet. A free thread has a label … Exactly one of the two, never both, never neither», immediately contradicted by the three-kind comment at 212-217 and by CONSTRAINT thread_kind_exactly_one (234-236). The table COMMENT at 240 says the general thread is 'a facet-less, label-less row — see thread_general below'; there is no thread_general in the file, and general threads are is_general=true.

**Arreglo:** Delete the two-kind paragraph at 209-211 and rewrite the COMMENT at 239-240 to describe is_general.

## 31. [NIT] No down/rollback section. It is recoverable, but the exact statements are not written down anywhere.

**Evidencia:** The file ends at COMMIT (line 491) with only a prose "what stage 2 owes" (479–489). Verified nothing is destructive, so the undo is a pure drop: `DROP FUNCTION public.can_read_thread(uuid); DROP FUNCTION public.has_facet(uuid,uuid,uuid,uuid,text,public.facet_verb); DROP FUNCTION public.container_chain(uuid,uuid,uuid,uuid); DROP TABLE public.message, public.thread_participant, public.thread, public.membership_facet, public.membership, public.facet_level, public.facet CASCADE; DROP TYPE public.facet_verb; DROP TYPE public.container_level;` — indexes and policies go with the tables. The only thing not recoverable is any membership row hand-created after apply.

**Arreglo:** Append that block as a commented `-- DOWN` section, as the record of what undo costs.

## 32. [NIT] container_chain is a SECURITY DEFINER function in the public schema with no caller check, so PostgREST exposes /rpc/container_chain as a cross-tenant ancestry oracle.

**Evidencia:** Lines 310–330: SECURITY DEFINER, reads public.performance / public.line / public.project with RLS bypassed, and returns the project and workspace ids for any performance uuid passed in — from any workspace, for any authenticated user. has_permission (rls-policies.sql:98) is also SECURITY DEFINER but returns only a boolean about the caller; this one returns other tenants' identifiers.

**Arreglo:** Either mark it as intended-internal and `REVOKE EXECUTE ON FUNCTION public.container_chain(uuid,uuid,uuid,uuid) FROM authenticated, anon;` (it is only called from has_facet, itself SECURITY DEFINER), or gate its output on is_workspace_member of the resolved workspace.

