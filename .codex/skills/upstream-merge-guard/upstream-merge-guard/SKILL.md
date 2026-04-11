---
name: upstream-merge-guard
description: Use when fetching from the original TREK repo and selectively merging upstream changes into this repo while preserving protected local features. Apply for upstream syncs, conflict resolution, migration review, and post-merge verification.
---

# Upstream Merge Guard

## Overview

Use this skill when merging or rebasing changes from the original TREK repository into this repo. The goal is to take upstream improvements without regressing protected local features.

This skill is for:
- fetching `upstream/main` or another upstream branch
- reviewing upstream deltas before merge
- resolving merge conflicts selectively
- checking migrations and service-layer compatibility
- verifying protected features still work after the merge

Do not treat upstream as authoritative in overlap areas. In overlap areas, preserve protected features first and integrate upstream additively.

## Protected Features

These features are protected by default and must not be overridden during upstream merges unless the user explicitly says to replace them.

1. `Vacay` work calendar behavior
   - company holidays are per-user, not just per-plan
   - the Vacay calendar can show multiple users on the same day

2. Planner day sections
   - `Morning / Afternoon / Night` day view must remain intact

3. Per-user packing
   - packing ownership remains per-user
   - do not collapse it back to trip-level shared ownership

If the user adds more protected features later, append them to this list and treat them with the same priority.

## Core Rule

When upstream and local work overlap:

- preserve the protected local feature model first
- merge upstream improvements around that model
- do not accept upstream blindly in schema, service, route, or UI files tied to protected features

If a conflict cannot be resolved without changing protected behavior, stop and explain the exact tradeoff instead of making a silent compromise.

## Workflow

### 1. Inspect Upstream Scope

Before editing anything:

- fetch upstream refs
- review the size and shape of the upstream delta
- identify files touching protected features
- separate additive upstream work from overlap/risk areas

Useful commands:

```bash
git fetch upstream
git diff --stat HEAD...upstream/main
git diff --name-only HEAD...upstream/main
```

Focus first on:
- migrations
- routes
- services
- client components tied to protected features

### 2. Identify Protected Overlap Files

Treat these files as high-risk whenever upstream touches them:

- `server/src/db/migrations.ts`
- `server/src/services/vacayService.ts`
- `client/src/components/Planner/DayPlanSidebar.tsx`
- `server/src/services/assignmentService.ts`
- `server/src/routes/packing.ts`
- `server/src/services/packingService.ts`
- `client/src/components/Packing/PackingListPanel.tsx`
- `server/src/mcp/tools.ts`

Also inspect nearby files if upstream spreads related logic into:
- `client/src/types.ts`
- `client/src/api/client.ts`
- `client/src/components/PDF/TripPDF.tsx`
- `server/src/services/dayNoteService.ts`
- `server/src/services/tripService.ts`

### 3. Merge Selectively

Use this strategy:

- take upstream broadly for unrelated infra, docs, workflows, tests, and isolated features
- manually merge protected-overlap files
- preserve local schema assumptions and ownership models
- keep upstream additions that do not break protected behavior

Examples:

- if upstream improves packing templates, quantities, or bag members, keep those additions
- but do not remove per-user packing ownership or access control
- if upstream refactors planner rendering, keep the refactor only if `Morning / Afternoon / Night` still exists
- if upstream changes Vacay storage or rendering, preserve per-user holidays and multi-user-per-day display

### 4. Review Migrations Carefully

Migrations are a primary failure point after upstream merges.

Check for:
- duplicate column additions
- renamed columns being renamed a second time
- schema normalization migrations that assume older tables than this repo now has
- unique constraints that would collapse protected feature behavior

Rules:

- make migrations idempotent when mixed-schema histories are possible
- do not remove `user_id` from protected-feature tables
- do not replace protected schemas with simpler upstream assumptions

### 5. Verify Protected Behavior

After conflicts are resolved, verify both syntax-level and behavior-level integrity.

Minimum checks:

- `git diff --check`
- inspect resolved files for leftover conflict markers
- inspect migrations touching protected data models
- inspect service-layer queries and mutation guards
- inspect client components for protected UI behavior

Targeted verification checklist:

- Vacay:
  - company holidays still key off `user_id`
  - same-day multiple users still remain representable

- Planner:
  - `Morning / Afternoon / Night` sections still render
  - `day_section` behavior still exists through assignment/note flows

- Packing:
  - ownership is still per-user
  - route/service mutations still enforce per-user access
  - upstream packing enhancements do not flatten ownership

If test tooling is available, run targeted tests for these areas. If it is not available, state that clearly and fall back to static verification.

### 6. Report Clearly

Summarize the merge in terms of:

- what upstream features were incorporated
- which protected features were preserved
- which files required manual conflict resolution
- any remaining risks or unverified areas

Do not describe the result as a clean upstream sync if protected-feature divergence remains intentional.

## Decision Standard

When in doubt, prefer:

1. preserving protected behavior
2. accepting additive upstream improvements
3. making mixed-history migrations safe
4. documenting residual risk explicitly

Do not optimize for a minimal diff if that would silently regress a protected feature.
