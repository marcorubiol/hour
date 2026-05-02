> **HISTORICAL PROMPT** — reset v2 already executed 2026-04-19
>
> This was the task prompt for the schema reset v2. Do not use as current instruction.
> Current schema lives in `build/migrations/2026-05-01_reset_v2_roadsheet.sql`.

---

# Reset v2 prompt — for Windsurf (ARCHIVED)

Original date: 2026-04-19
Execution: Completed via Windsurf session

## Task summary (archival)

Seven ADRs added to `_decisions.md`, `schema.sql` and `rls-policies.sql` rewritten for reset v2:
- Engagement distinct from Show (ADR-001)
- Show.status with hold variants (ADR-002)
- Money stack (invoice/payment/expense) (ADR-003)
- Reset before real data (ADR-004)
- Line as intermediate table (ADR-005)
- RBAC with workspace_role catalog (ADR-006)
- No project.type column (ADR-007)

Result: 18 tables, polymorphic core, RLS hardened.

## Subsequent delta (roadsheet, 2026-05-01)

Added 4 tables via `2026-05-01_reset_v2_roadsheet.sql`:
- crew_assignment
- cast_override
- asset_version
- collab_snapshot

Total: 22 tables in production.
