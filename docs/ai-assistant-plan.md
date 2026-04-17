# TREK AI Assistant Plan

## Goal

Add a traveler-facing AI assistant to TREK in a way that delivers useful value quickly and does not require a later rewrite when we add write capabilities.

The first shipped version should be read-only. It should answer questions about an existing trip, summarize trip state, identify gaps, and suggest next actions without mutating data.

Later versions can add narrow write actions with explicit confirmation.

## Why This Shape

TREK already has strong structured trip data:

- trip overview and summary data in [server/src/services/tripService.ts](/C:/Users/richard/Documents/dev/TREK/server/src/services/tripService.ts)
- MCP-style typed tools in [server/src/mcp/tools.ts](/C:/Users/richard/Documents/dev/TREK/server/src/mcp/tools.ts)
- client API surfaces in [client/src/api/client.ts](/C:/Users/richard/Documents/dev/TREK/client/src/api/client.ts)

That means the right implementation is not a generic chatbot bolted onto UI text. The assistant should be a tool-driven layer over existing TREK entities.

## Product Scope

### Phase 1: Read-Only Assistant

The assistant can:

- summarize a trip
- answer itinerary questions
- identify overloaded or underplanned days
- summarize reservations
- summarize budget status
- summarize packing progress
- summarize todos and unresolved prep work
- explain who is assigned to activities
- propose next steps without executing them

The assistant cannot:

- create, edit, delete, reorder, or move trip data
- make hidden assumptions when data is missing
- fabricate bookings, participants, or costs

### Future Phases

Phase 2 should add draftable actions with explicit confirmation:

- add packing item
- add todo item
- create day note
- set assignment time
- move assignment between days
- update assignment section

Phase 3 can add guided trip-management flows:

- repair a thin itinerary
- rebalance overloaded days
- create a traveler brief
- prepare a departure checklist

## Core Principles

### 1. Tools, Not Raw Database Access

The assistant should only read or write through typed application tools. It should never query the database directly.

This keeps:

- business rules in the application layer
- permission checks in one place
- future write safety manageable

### 2. Grounded Answers

Every answer should be based on actual trip entities and should reference the underlying data it used.

Examples:

- cited day IDs or day numbers
- reservation IDs or labels
- packing categories or item counts
- budget totals and member-level summaries

### 3. Preserve Protected Local Features

The assistant design must respect the same protected features preserved during upstream merges:

- planner must retain `Morning / Afternoon / Night`
- packing ownership remains per-user
- Vacay behavior remains per-user and multi-user-per-day aware

Even though Phase 1 is read-only, later write tools must encode these rules explicitly instead of relying on prompt instructions.

### 4. Write Actions Must Be Narrow and Confirmed

When writes are introduced later, the assistant should:

1. propose a concrete action
2. show a preview
3. require explicit confirmation
4. execute a narrow typed tool
5. report the result

No freeform "let the model edit anything" flow should be allowed.

## Recommended Architecture

Use three layers.

### Assistant UI

A trip-scoped chat panel in the client.

Responsibilities:

- capture user prompt
- show grounded answer cards
- show citations / source entities
- show suggested actions as previews
- later host confirmation flows for writes

### Assistant Orchestrator

A server-side assistant service that:

- accepts a trip-scoped request
- chooses which read tools to call
- assembles compact structured context
- calls the LLM
- returns normalized answer payloads

This layer should remain stateless for MVP other than normal request handling.

### Trip Tool Layer

Typed read and write tools over existing services.

This should be implemented as a dedicated assistant-facing tool registry rather than reusing raw client payloads directly.

The current MCP implementation in [server/src/mcp/tools.ts](/C:/Users/richard/Documents/dev/TREK/server/src/mcp/tools.ts) is the best existing architectural reference.

## MVP Tool Set

Phase 1 should start with a small read-only tool set.

### Read Tools

- `get_trip_overview(tripId)`
- `get_trip_days(tripId)`
- `get_day_plan(tripId, dayId)`
- `get_trip_members(tripId)`
- `get_reservations_summary(tripId)`
- `get_budget_summary(tripId)`
- `get_budget_settlement(tripId)`
- `get_packing_summary(tripId)`
- `get_todo_summary(tripId)`
- `get_day_notes_summary(tripId, dayId?)`

Implementation note:

- `get_trip_overview` can build on the existing `getTripSummary` pattern in [server/src/services/tripService.ts](/C:/Users/richard/Documents/dev/TREK/server/src/services/tripService.ts)
- some of these may be wrappers over existing service calls rather than brand-new data access logic

### Future Write Tools

Define these as future interfaces now, even if they are not wired yet:

- `create_day_note`
- `add_packing_item`
- `assign_packing_item`
- `create_todo_item`
- `move_assignment`
- `set_assignment_time`
- `set_assignment_section`

All future write tools should:

- validate access
- validate invariants
- broadcast updates through normal app flows
- return previewable structured results

## API and Data Flow

### Proposed Server Endpoint

Add a trip-scoped assistant endpoint, for example:

- `POST /api/trips/:tripId/assistant/query`

Request:

- user message
- optional current day / selected entity context
- optional conversation history window

Response:

- assistant answer
- citations / referenced entities
- optional suggested actions
- optional follow-up prompts

### Response Shape

Use a structured response, not just plain markdown text.

Suggested shape:

- `answer`
- `citations`
- `suggested_actions`
- `warnings`
- `missing_data`

This gives the UI room to evolve later without changing the contract.

## UX Recommendations

### MVP UI

Place the assistant as a trip-scoped sidebar or panel.

Good quick prompts:

- "Summarize this trip"
- "What still needs planning?"
- "Which days are busiest?"
- "Who still needs to pack?"
- "Summarize our reservations"
- "What should we finalize before departure?"

### Answer Design

Prefer compact sections backed by actual trip entities.

Examples:

- itinerary summary
- planning risks
- packing status
- reservation checklist
- budget highlights

### Suggested Actions

Even in read-only mode, surface disabled or non-executable suggestion chips such as:

- "Add sunscreen to packing"
- "Move museum to Thursday afternoon"
- "Create a departure checklist"

This teaches users the future interaction model without introducing unsafe writes in MVP.

## Permissions and Safety

The assistant must respect the same permissions as the normal app.

Rules:

- trip membership is required for trip-scoped answers
- admin-only data stays admin-only
- per-user packing ownership should not be flattened in assistant summaries
- if a user cannot normally see or change something, the assistant should not expose it

Additional safety rules:

- always state when data is incomplete
- never infer a reservation status not present in data
- never claim a plan is confirmed if it is only proposed

## LLM Strategy

For MVP, prefer a simple orchestration flow:

1. classify the request
2. call a small number of read tools
3. build compact structured context
4. generate a grounded answer

Do not start with:

- open-ended autonomous planning loops
- background agents
- write access
- large unbounded history windows

## Implementation Plan

### Milestone 1: Tooling

- create assistant-specific read tool interfaces on the server
- reuse existing service-layer queries where possible
- normalize output shapes for LLM consumption

### Milestone 2: Assistant Endpoint

- add a trip-scoped assistant route
- wire auth and trip access checks
- implement basic orchestration
- return structured answer payloads

### Milestone 3: Client UI

- add assistant panel to the trip experience
- add prompt input and quick actions
- render answer blocks and citations
- render suggested actions as non-executable previews

### Milestone 4: Validation

- test grounded answers against real trip data
- verify permission boundaries
- verify no protected feature semantics are flattened in summaries

### Milestone 5: Write-Ready Refactor

Before introducing writes:

- add explicit action-preview contracts
- separate proposal generation from execution
- introduce write tools one by one

## Suggested File Targets

These are likely starting points rather than a final exhaustive list.

Server:

- [server/src/services/tripService.ts](/C:/Users/richard/Documents/dev/TREK/server/src/services/tripService.ts)
- [server/src/mcp/tools.ts](/C:/Users/richard/Documents/dev/TREK/server/src/mcp/tools.ts)
- new assistant service and route files under `server/src/services` and `server/src/routes`

Client:

- [client/src/api/client.ts](/C:/Users/richard/Documents/dev/TREK/client/src/api/client.ts)
- a new assistant panel component under `client/src/components`
- whichever trip page or sidebar owns trip-level utility panels

## Risks

### Product Risks

- assistant answers feel generic if context is not grounded enough
- users expect writes too early if suggestion UI is unclear
- large prompts become slow or expensive if too much trip state is injected

### Engineering Risks

- duplicating MCP logic instead of sharing tool patterns
- leaking permissions by summarizing data too broadly
- future write support becoming unsafe if read and write contracts are not separated early

## Recommended MVP Success Criteria

The MVP is successful if a user can:

- ask practical questions about a trip and get grounded answers
- identify missing planning work faster than manually clicking around
- trust that the assistant is reading real TREK data
- see a clear path to future assistant actions without any silent mutations

## Explicit Non-Goals For MVP

- autonomous trip management
- background monitoring
- third-party booking automation
- direct edits without confirmation
- global assistant mode outside trip scope

## Next Step After This Doc

Implement the server-side read tool layer first. That is the foundation for both the read-only assistant and future write-enabled assistant flows.
