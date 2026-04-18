# TREK AI Assistant Plan

## Goal

Add a traveler-facing AI assistant to TREK in a way that delivers useful value quickly and does not require a later rewrite when we add write capabilities.

The first shipped version should be read-only. It should answer questions about an existing trip, summarize trip state, identify gaps, and suggest next actions without mutating data.

Later versions can add narrow write actions with explicit confirmation.

## Current Planning Status

The current implementation focus is confirmed:

- build only Phase 1 first
- use a local LLM only
- keep the assistant read-only
- make the UI feel like a ChatGPT-style chatbot
- place it in the trip planner as a minimizable side panel rather than a separate page

This means the first milestone is not just server tooling. The first shipped experience must already look like the long-term assistant product, even though write actions remain disabled.

Current implementation status:

- the Phase 1 vertical slice is now underway
- the first implementation target is panel shell + endpoint contract + local-provider server path
- the first version should prove the interaction model before deeper tool coverage or write-ready confirmations
- place-specific general-knowledge questions should only be answered from stored TREK data; if TREK only knows that a place exists in the trip, the assistant should say it lacks trusted descriptive information instead of inventing travel facts

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
- answer general world-knowledge place questions as if TREK has internet/search access when that data is not actually stored in the trip

### Future Phases

Phase 2 should add draftable actions with explicit confirmation:

- add packing item
- add todo item
- create day note
- set assignment time
- move assignment between days
- update assignment section

Phase 2 should also add hosted-model provider support behind the same assistant interface:

- OpenAI API
- Anthropic API
- Gemini API
- Perplexity API

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
- render a conversational message history
- show grounded answer cards
- show citations / source entities
- show suggested actions as previews
- support open / close / minimize behavior
- later host confirmation flows for writes

Phase 1 UX clarification:

- the assistant should feel like a real chatbot similar to ChatGPT
- it should live inside the trip planner experience
- it should be minimizable so users can keep planning while chatting
- it should not require navigating away to a dedicated assistant page

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

Important implementation clarification:

- use MCP tool patterns as a reference
- do not make the in-app assistant depend directly on the MCP server transport
- the app assistant should call assistant-facing server services that reuse existing business logic

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
- `meta`

This gives the UI room to evolve later without changing the contract.

Phase 1 response note:

- the UI should render assistant replies as chat messages
- structured fields should be attached to those messages rather than replacing the chat format
- `meta` should be able to report provider, model, and tool usage for debugging

### Phase 1 Request Shape

Use a single-turn request format that still leaves room for future conversation memory.

Suggested request shape:

- `message`
- `history`
- `context`

Suggested details:

- `message`: the latest user prompt
- `history`: a short recent window of prior chat messages
- `context`: optional planner context such as selected day, selected place, selected assignment, or active tab

Suggested example:

```json
{
  "message": "What still needs planning before we leave?",
  "history": [
    { "role": "user", "content": "Summarize this trip" },
    { "role": "assistant", "content": "..." }
  ],
  "context": {
    "selected_day_id": 12,
    "selected_place_id": null,
    "selected_assignment_id": null,
    "active_tab": "plan"
  }
}
```

Phase 1 conversation rule:

- keep history short and bounded
- do not rely on large persistent chat transcripts for correctness
- regenerate grounded context from tools on every request

### Phase 1 Message Response Shape

The endpoint should return one assistant message object plus supporting structured fields.

Suggested shape:

```json
{
  "message": {
    "role": "assistant",
    "content": "You still need to finalize two reservations and assign packing for Alex."
  },
  "citations": [],
  "suggested_actions": [],
  "warnings": [],
  "missing_data": [],
  "follow_up_prompts": [],
  "meta": {
    "provider": "local",
    "model": "local-model-name",
    "tools_used": ["get_trip_overview", "get_reservations_summary", "get_packing_summary"]
  }
}
```

This keeps the UI chat-first while still exposing structured metadata.

## UX Recommendations

### MVP UI

Place the assistant as a trip-scoped sidebar or panel.

The current preferred MVP shape is:

- a right-side assistant panel in the trip planner
- collapsible / minimizable behavior
- chat transcript, prompt input, and quick prompt chips
- structured citations and warnings rendered under each assistant message when available

### Phase 1 Panel Behavior

The current preferred interaction model is:

- right-side assistant panel in the trip planner
- closed by default for MVP unless we decide to surface it with a first-run affordance
- expandable to a large working width, then minimizable to a narrower but still usable chat panel
- close should return the assistant to its launcher button state
- minimize should preserve a working chat UI rather than collapsing to a non-interactive preview
- independent from the existing planner sidebars so users can continue planning while the assistant stays open
- conversation state remains available while switching planner tabs within the same trip session

Recommended states:

- `closed`
- `open`
- `minimized`

Recommended panel contents:

- header with assistant title and minimize / close controls
- scrollable chat transcript
- optional quick prompt chips at the top when the conversation is empty
- prompt composer anchored to the bottom
- loading indicator for in-flight responses

Implemented Phase 1 interaction details:

- `Enter` submits the current message
- `Shift+Enter` inserts a newline
- reopening or expanding the assistant should scroll the transcript to the newest messages
- minimized state should keep the message history and composer available
- the assistant currently appears only on the `plan` tab

Recommended MVP non-goals for the panel:

- no multi-thread conversation list
- no cross-trip assistant memory
- no floating freeform global assistant outside the trip experience

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

## LLM Deployment Strategy

The assistant should be designed so the LLM provider can be swapped without changing the assistant UI, tool layer, or business rules.

### Initial Deployment Target

The initial target is a local model running on a single RTX 4090 through LM Studio or another OpenAI-compatible local server.

This is a good fit for Phase 1 because:

- the MVP is read-only
- the assistant should answer from TREK data, not from the public internet
- the tool layer can keep prompts compact and structured
- the model only needs to reason over retrieved trip context

### Why Local-First Works For MVP

For a read-only trip assistant, lack of direct internet access is not a blocker.

The assistant should not browse on its own. Instead:

1. TREK retrieves trip data through its own tools
2. TREK passes only relevant structured context to the LLM
3. the LLM produces a grounded answer

This is safer and better aligned with TREK's structured data model than giving the model open-ended access.

### Why Provider Swapping Matters

If the assistant later becomes more ambitious, model quality and external-data needs will increase.

Examples:

- more reliable reasoning across larger trip contexts
- better summarization across many entities
- stronger action proposal quality
- live external intelligence such as travel advisories, web recommendations, or flight insights

At that point, TREK may need to use hosted models such as ChatGPT or Claude for some requests.

The design should therefore support:

- local-only mode
- hosted-only mode
- hybrid mode with local-first and hosted fallback

Hosted-provider note:

- hosted support should be implemented without changing the trip assistant UI, route contract, or tool contracts
- TREK should remain the orchestrator and grounding layer even when a hosted model is used
- provider-specific request/response formats should be normalized in the server provider layer

### Recommended Provider Interface

Add a thin provider abstraction in the server assistant layer.

Example responsibilities:

- send model request
- pass system prompt and tool context
- normalize response shape
- report provider and model metadata
- support timeout and fallback behavior

Recommended future provider set:

- `local`
- `openai`
- `anthropic`
- `gemini`
- `perplexity`

Suggested configuration model:

- `provider`: `local`, `openai`, `anthropic`, or future providers
- `model`
- `base_url`
- `api_key` when required
- `timeout_ms`
- `max_tokens`

The assistant route should depend on this interface rather than any specific SDK.

Recommended normalized interface:

- provider input:
  - `systemPrompt`
  - `userPrompt`
  - `temperature`
  - `maxTokens`
- provider output:
  - `provider`
  - `model`
  - `content`
  - optional normalized token usage

Suggested server file layout for future hosted support:

- `server/src/services/assistant/provider.ts`
- `server/src/services/assistant/providers/base.ts`
- `server/src/services/assistant/providers/factory.ts`
- `server/src/services/assistant/providers/local.ts`
- `server/src/services/assistant/providers/openai.ts`
- `server/src/services/assistant/providers/anthropic.ts`
- `server/src/services/assistant/providers/gemini.ts`
- `server/src/services/assistant/providers/perplexity.ts`

Implementation rule:

- the orchestrator should never depend on provider-specific payload shapes
- only the provider adapters should know OpenAI, Anthropic, Gemini, or Perplexity request formats

Phase 1 constraint:

- only the `local` provider should be wired initially
- the provider interface should still be shaped so hosted providers can be added later without changing the route contract or UI

### Local Model Expectations

A single RTX 4090 is enough for the Phase 1 read-only assistant if the system is designed correctly.

That means:

- targeted tool calls
- compact prompts
- trip-scoped requests
- structured outputs

It should not assume:

- entire-trip raw dumps into context
- huge conversation windows
- autonomous multi-step planning

### External Data Strategy

If future versions need internet-backed information, the LLM should still not browse the web directly.

Instead:

- TREK should call external APIs or web-backed integrations itself
- TREK should pass the retrieved results into the assistant as tool outputs
- the LLM should synthesize those results

This keeps the architecture consistent across both local and hosted models.

### Recommended Evolution Path

1. Phase 1: local model only, read-only assistant
2. Phase 2: keep the same tool layer, improve prompts and answer quality
3. Phase 3: add hosted-model support behind the same provider interface
4. Phase 4: optionally route complex prompts or internet-backed prompts to hosted models

### Non-Goal

Do not couple assistant behavior to one specific model vendor or SDK.

Secret handling rule:

- hosted-provider API keys must remain server-side only
- they should be treated as deployment secrets or secret environment variables
- they must never be exposed to the client
- examples include:
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `GEMINI_API_KEY`
  - `PERPLEXITY_API_KEY`

The tool contracts and response schema should remain stable even if the backing LLM changes.

## Implementation Plan

### Milestone 1: Tooling

- create assistant-specific read tool interfaces on the server
- reuse existing service-layer queries where possible
- normalize output shapes for LLM consumption

Current guidance:

- start with a minimal read-only tool set rather than implementing the entire future catalog up front
- prefer compact context builders over passing full denormalized trip payloads into every request

Recommended first tool slice:

- `get_trip_overview(tripId)`
- `get_trip_days(tripId)`
- `get_reservations_summary(tripId)`
- `get_packing_summary(tripId)`
- `get_todo_summary(tripId)`

Why this first slice:

- it covers the most common Phase 1 user questions
- it keeps context compact enough for a local model
- it avoids prematurely building fine-grained day and budget tooling before the chat contract is proven

Recommended second slice after the MVP shell works:

- `get_day_plan(tripId, dayId)`
- `get_trip_members(tripId)`
- `get_budget_summary(tripId)`
- `get_day_notes_summary(tripId, dayId?)`

### Milestone 2: Assistant Endpoint

- add a trip-scoped assistant route
- wire auth and trip access checks
- implement basic orchestration
- add a pluggable LLM provider interface
- return structured answer payloads

Recommended Phase 1 orchestration flow:

1. accept trip-scoped request
2. validate membership and planner context
3. classify the user question into a small intent set
4. call only the relevant read tools
5. assemble compact structured context
6. call the local provider
7. return one assistant message plus structured metadata

### Milestone 3: Client UI

- add assistant panel to the trip experience
- add prompt input and quick actions
- render answer blocks and citations
- render suggested actions as non-executable previews

Current guidance:

- the client should prioritize a polished chatbot shell early
- conversation state should start local to the assistant panel instead of being merged into the main trip Zustand store
- the first UI target should be [client/src/pages/TripPlannerPage.tsx](/Users/rich/Documents/dev/TREK/client/src/pages/TripPlannerPage.tsx)

Recommended build order:

1. add the panel shell and state management in the planner page
2. wire the assistant API client
3. render a static mock transcript to validate layout and panel behavior
4. connect real assistant responses
5. add citations, warnings, and suggested-action rendering

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

More specific likely targets based on current code inspection:

Server:

- [server/src/routes/trips.ts](/Users/rich/Documents/dev/TREK/server/src/routes/trips.ts) or a new sibling route mounted under `/api/trips/:tripId`
- [server/src/app.ts](/Users/rich/Documents/dev/TREK/server/src/app.ts) for route registration
- new files under `server/src/services/assistant`

Client:

- [client/src/pages/TripPlannerPage.tsx](/Users/rich/Documents/dev/TREK/client/src/pages/TripPlannerPage.tsx) as the host experience
- [client/src/api/client.ts](/Users/rich/Documents/dev/TREK/client/src/api/client.ts) for the assistant query method
- a new `client/src/components/Assistant/TripAssistantPanel.tsx`

## Current Findings From Code Review

The following has already been confirmed in the existing codebase:

- [server/src/services/tripService.ts](/Users/rich/Documents/dev/TREK/server/src/services/tripService.ts) already exposes `getTripSummary`, which is a useful seed for `get_trip_overview`
- [server/src/mcp/tools.ts](/Users/rich/Documents/dev/TREK/server/src/mcp/tools.ts) demonstrates the typed-tool pattern we should mirror
- [client/src/api/client.ts](/Users/rich/Documents/dev/TREK/client/src/api/client.ts) already follows the trip-scoped API style we should extend
- [client/src/pages/TripPlannerPage.tsx](/Users/rich/Documents/dev/TREK/client/src/pages/TripPlannerPage.tsx) already owns the trip shell, tabs, and side panels, making it the right home for the assistant panel

Additional implementation finding:

- the planner already has dense left and right panel behavior on desktop, so the assistant should be implemented as an overlay panel anchored above planner content rather than becoming a third resizable sidebar

## Current Blockers and Open Decisions

There are no hard technical blockers yet, but there are a few decisions to lock before implementation:

- how much recent conversation history to send per request
- what the local provider config surface should look like in app settings or environment

The following decisions are now tentatively locked for implementation unless a better constraint appears during build:

- the assistant will be a ChatGPT-style minimizable side panel in `TripPlannerPage`
- the API will be chat-first and return one assistant message plus structured metadata
- the initial tool set will be a small read-only slice centered on overview, days, reservations, packing, and todos

Known engineering caution:

- `getTripSummary` is useful, but it is probably too broad to dump into every prompt unchanged
- we should shape smaller assistant-specific context payloads to keep the local model responsive

Likely next blockers once implementation starts:

- fitting the assistant panel cleanly alongside the planner's existing right-side UI without crowding mobile layouts
- deciding whether local provider configuration belongs purely in server env vars for Phase 1 or also needs user-visible settings
- tuning the amount of structured context so the local model stays fast while still producing grounded answers

## Implementation Progress Log

### In Progress

The current vertical slice implementation includes:

- trip-scoped assistant endpoint at `POST /api/trips/:tripId/assistant/query`
- assistant service files under `server/src/services/assistant`
- local OpenAI-compatible provider path for LM Studio style backends
- assistant panel component in the trip planner UI
- client API wiring in `client/src/api/client.ts`
- selected-day-aware context loading for assistant queries
- follow-up prompt chips rendered from assistant responses
- per-trip session persistence for panel state and recent chat messages
- enter-to-send and shift-enter newline handling
- reopen-to-bottom chat scrolling
- open / minimize / close behavior aligned to the final Phase 1 chat UX

### Current Constraints Encountered

- desktop planner space is already crowded, so the assistant panel should overlay instead of joining the existing resizable panel system
- mobile should use a full-screen sheet variant instead of the desktop floating panel dimensions
- local provider configuration is still env-driven in the first slice; no user-facing configuration UI has been added yet
- verification in this workspace is incomplete because the client build currently fails before app compilation when `sharp` is unavailable and there is no runnable local TypeScript CLI in the checked-in toolchain here
- because LM Studio will be started manually for personal use, the chat UX should handle missing/offline local-model states cleanly instead of depending on extra setup or health-check UI

### Phase 1 Status

Phase 1 feature work is implemented.

The remaining gap is verification/signoff rather than missing product behavior:

- targeted validation once the workspace toolchain can build/typecheck cleanly
- any final refinement needed after local-model use against real trips

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
