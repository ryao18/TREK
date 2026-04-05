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
- opening the trip creation modal
- typing trip titles and descriptions
- submitting new trips
- asserting that a submitted trip title eventually appears on the dashboard
- opening trip cards after creation
