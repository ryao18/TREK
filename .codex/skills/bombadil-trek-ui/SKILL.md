---
name: bombadil-trek-ui
description: Create or refine Bombadil specs for TREK's UI workflows. Use when Codex needs to author, tighten, or debug `bombadil/*.ts` specs for TREK, especially around planner flows, bookings, packing, budget, and collab behavior. Use this skill when Bombadil is drifting into generic UI, flaky selectors, upload dialogs, logout/auth detours, or missing TREK's core in-trip workflows.
---

# Bombadil TREK UI

## Overview

Author Bombadil specs that behave like a TREK user, not a generic crawler. Keep the spec centered on one trip, prioritize planner and in-trip workflows, and avoid coverage that depends on file uploads or Bombadil's generic action pool.

## Workflow

1. Read the existing Bombadil spec first.
2. Inspect the actual TREK components and translations before changing selectors.
3. Export a single directed weighted workflow unless there is a clear reason to expose multiple workflows.
4. Prefer app-specific actions and invariants over Bombadil defaults.
5. Tighten weights toward the user-requested workflow instead of broadening the spec.
6. Update the Bombadil README when the workflow emphasis changes.

## Priorities

- Keep Bombadil inside one `/trips/:id` route for long stretches.
- Exercise planner flows first: add place/activity, assign to day, move through `Morning` / `Afternoon` / `Night`, reorder items.
- Exercise in-trip surfaces next: bookings, packing, budget, collab chat, collab notes, collab polls.
- Create at most one trip if none exist. Otherwise open an existing trip immediately.
- Use eventual-appearance properties tied to exact text entered by the spec.

## Selector Rules

- Prefer stable placeholders, button text, titles, and visible tab labels.
- Use TREK translations and component structure to confirm the selector source.
- Prefer explicit controls over free-form drag and drop when both hit the same logic.
- For planner placement, prefer section chips (`M`, `A`, `N`) and reorder arrows over OS-style drag events.
- Avoid selectors that depend on layout-only class names unless there is no better anchor.

Read [references/trek-ui-surfaces.md](references/trek-ui-surfaces.md) when adding or changing selectors for TREK panels.

## Avoid

- Do not re-export Bombadil's generic default action pool when the goal is targeted TREK workflow coverage.
- Do not include file upload, GPX import, Google list import, or other OS/file-picker paths.
- Do not add logout coverage unless the user explicitly asks for it.
- Do not let trip settings/edit dialogs dominate the action pool unless the task is specifically about those dialogs.
- Do not overuse generic dashboard wandering once an existing trip can be opened.

## Invariants

- Keep login avoidance, spinner settling, and toast sanity checks.
- Add workflow-specific eventual guarantees:
  - created planner activity title appears
  - booking title appears
  - packing item appears
  - budget entry appears
  - chat message appears
  - note title appears
  - poll question appears
- Prefer guarantees that tie directly to the text Bombadil typed rather than vague page-state checks.

## Refinement Loop

When Bombadil misses the intended area:

1. Check whether the spec still exports generic actions or defaults.
2. Raise the weight of the missed workflow and lower unrelated navigation.
3. Tighten selectors to the exact TREK control rather than broad `button` pools.
4. Replace flaky drag interactions with equivalent explicit controls where possible.
5. Split into focused specs only if one weighted workflow is no longer coherent.

## Outputs

When using this skill, update only the files that matter:

- `bombadil/*.ts` for the spec
- `bombadil/README.md` when the testing emphasis or exclusions change
- optional repo-local skill references if the TREK UI map needs to be expanded
