# EF Map Deep Link & Embed Guide

## Query-based system highlight
- Format: `https://ef-map.com/?system=<solarSystemId>`
- Example (default zoom): `https://ef-map.com/?system=30000001` – keeps the default camera distance (`5000`).
- Example with zoom override: `https://ef-map.com/?system=30000001&zoom=2500` – starts closer than the default zoom.
- Example with auto-orbit: `https://ef-map.com/?system=30000001&orbit=1` – starts in cinematic orbit mode until the user interacts.
- Example with orbit + palette: `https://ef-map.com/?system=30000001&orbit=1&color=green` – orbits with the green cinematic starfield.
- `<solarSystemId>` must match the numeric identifier used in the Datacore/World exports (e.g., `30000001`).
- On load the map selects the system, shows the in-map label, and applies the same highlight used when a user left-clicks it.
- Additional parameters (for example `share` hashes) still take priority; the system query runs only when no shared route is applied.

## Numeric path variant (optional)
- Format: `https://ef-map.com/<solarSystemId>`
- Example (default zoom): `https://ef-map.com/30000001`
- Example with zoom override: `https://ef-map.com/30000001?zoom=7500` – starts farther out than the default zoom.
- Example with auto-orbit: `https://ef-map.com/30000001?orbit=1` – same cinematic orbit behavior as the query parameter.
- Example with orbit + palette: `https://ef-map.com/30000001?orbit=1&color=green` – uses the green cinematic palette while orbiting.
- Behaves the same as the query parameter and exists for parity with external tools already storing numeric URLs.

## Embed mode (iframe friendly)
- Format: `https://ef-map.com/embed?system=<solarSystemId>` or append `&embed=1` to any map URL.
- UI chrome, panels, quick controls, persistent logo, and the "Gates OK" badge are hidden; the embed shows only the starfield, active selection, and the escape-pill CTA.
- Intended for partner sites to embed a focused view of a single system.
- An "Open on EF Map" pill appears in the top-right so viewers can launch the full experience in a new tab with the same system pre-selected.

### Example iframe snippet
```html
<iframe
  src="https://ef-map.com/embed?system=30000001&zoom=5000&orbit=1&color=green"
  width="640"
  height="360"
  frameborder="0"
  loading="lazy"
  allowfullscreen
></iframe>
```

### Optional query parameters
- `system`: numeric system id to highlight (recommended).
- `zoom`: camera distance in map units. Default is `5000`, minimum `10`, maximum `50000`. Smaller numbers zoom in tighter on the selected star.
- `embed=1`: activates the embed preset without needing the `/embed` path.
- `orbit=1`: enables cinematic mode automatically and orbits the camera around the selected system. The system label remains visible so viewers can identify the star. Any user interaction (click/drag) stops the orbit and hands over manual control.
- `color`: optional cinematic palette to apply when orbit mode is active. Supported values: `blue` (default), `green`, `purple`, `white`, `red`, `yellow`, `random`. Invalid or missing values fall back to `blue`.

## Notes & limitations
- The embedded view disables toolbar/UI controls; hosts should provide their own context or link to the full map.
- Usage telemetry still records a standard page load but skips the `ui_hide` event spam for embed sessions.
- For multi-system showcases or routes, continue using share links (`/s/<shareId>`). Route-aware embed presets are on the roadmap.
