# TREK UI Surfaces

Use this reference when writing or tightening TREK Bombadil selectors.

## Core Files

- `bombadil/trek.ts`
- `client/src/pages/TripPlannerPage.tsx`
- `client/src/components/Planner/DayPlanSidebar.tsx`
- `client/src/components/Planner/PlacesSidebar.tsx`
- `client/src/components/Planner/PlaceFormModal.tsx`
- `client/src/components/Planner/ReservationsPanel.tsx`
- `client/src/components/Planner/ReservationModal.tsx`
- `client/src/components/Packing/PackingListPanel.tsx`
- `client/src/components/Budget/BudgetPanel.tsx`
- `client/src/components/Collab/CollabPanel.tsx`
- `client/src/components/Collab/CollabChat.tsx`
- `client/src/components/Collab/CollabNotes.tsx`
- `client/src/components/Collab/CollabPolls.tsx`
- `client/src/i18n/translations/en.ts`

## Planner

Primary goal:
- add a place/activity
- assign it to a day
- move it between `Morning`, `Afternoon`, `Night`
- reorder it

Stable anchors:
- `Add Place/Activity`
- place form placeholders:
  - `e.g. Eiffel Tower`
  - `Short description...`
  - `Street, City, Country`
- day-section controls on planner rows:
  - titles `Morning`, `Afternoon`, `Night`
  - chip labels `M`, `A`, `N`
- reorder arrows on planner rows

Preferred behavior:
- use explicit add button from `PlacesSidebar`
- use assign-to-day plus button rather than drag from places list
- use section chips and arrow buttons rather than raw drag-and-drop

## Trip Tabs

Mounted from `TripPlannerPage.tsx`.

Useful tab labels:
- `Plan`
- `Bookings`
- `Packing List`
- `Budget`
- `Collab`

Prefer tab buttons near the fixed header over content-based navigation.

## Bookings

Stable anchors:
- `Manual Booking`
- title placeholder like `e.g. Lufthansa LH123, Hotel Adlon, ...`
- address/location placeholder
- notes placeholder `Additional notes...`

Avoid:
- attachment/file controls inside reservation modals

## Packing

Stable anchors:
- `Add item`
- item placeholder `Item name...`

Avoid:
- CSV/template/file import controls

## Budget

Stable anchors:
- row inputs:
  - `New Entry`
  - `0,00`
  - `Note`

Preferred behavior:
- add through inline add row
- avoid broad table clicking

## Collab

Stable anchors:
- chat placeholder `Type a message...`
- `New Note`
- note placeholders:
  - `Note title`
  - `Write something...`
- `New Poll`
- poll question placeholder `What should we do?`
- poll option placeholders `Option 1`, `Option 2`

Avoid:
- note attachment/file controls

## Explicit Exclusions

Never prioritize these in TREK Bombadil specs unless the user asks:

- file upload
- image upload
- note attachments
- GPX import
- Google list import
- logout
- generic dashboard wandering after a trip is open
