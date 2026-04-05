# Bombadil

This spec is tuned for local TREK testing with Docker and `LOCAL_AUTH_BYPASS=true`.

Run it against your local app:

```bash
bombadil test http://localhost:3000/dashboard bombadil/trek.ts
```

Recommended local env for Bombadil:

```dotenv
FORCE_HTTPS=false
COOKIE_SECURE=false
LOCAL_AUTH_BYPASS=true
```

What this spec emphasizes:

- staying out of the login page while local auth bypass is enabled
- creating a trip only when none exist, then spending most of the run inside one trip
- opening an existing trip from the dashboard and switching among planner tabs
- adding manual bookings without touching any file-upload controls
- adding packing-list items through the inline item flow
- adding budget entries through the inline budget row
- exercising collab chat, notes, polls, and poll voting
- checking that submitted booking titles, packing items, budget entries, chat messages, note titles, and poll questions eventually appear
- checking that trip planner routes load with tabs and sequential day badges

Intentionally excluded:

- any workflow that requires file upload
- logout coverage
