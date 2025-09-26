# EF Map Deep Link & Embed Guide

## Query-based system highlight
- Format: `https://ef-map.com/?system=<solarSystemId>`
- `<solarSystemId>` must match the numeric identifier used in the Datacore/World exports (e.g., `30000001`).
- On load the map zooms/selects the system just as if a user left-clicked it.
- Additional parameters (for example `share` hashes) still take priority; the system query runs only when no shared route is applied.

## Numeric path variant (optional)
- Format: `https://ef-map.com/<solarSystemId>`
- Behaves the same as the query parameter and exists for parity with external tools already storing numeric URLs.

## Embed mode (iframe friendly)
- Format: `https://ef-map.com/embed?system=<solarSystemId>` or append `&embed=1` to any map URL.
- UI chrome, panels, and quick controls start hidden; only the starfield, selection highlight, small logo, and indexer badge remain.
- Intended for partner sites to embed a focused view of a single system.
- An "Open on EF Map" pill appears in the top-right so viewers can launch the full experience in a new tab with the same system pre-selected.

### Example iframe snippet
```html
<iframe
  src="https://ef-map.com/embed?system=30000001"
  width="640"
  height="360"
  frameborder="0"
  loading="lazy"
  allowfullscreen
></iframe>
```

### Optional query parameters
- `system`: numeric system id to highlight (recommended).
- `embed=1`: activates the embed preset without needing the `/embed` path.
- Future extensions may add `zoom`, `autoRotate`, or `labels`; these will be documented here when available.

## Notes & limitations
- The embedded view disables toolbar/UI controls; hosts should provide their own context or link to the full map.
- Usage telemetry still records a standard page load but skips the `ui_hide` event spam for embed sessions.
- For multi-system showcases or routes, continue using share links (`/s/<shareId>`). Route-aware embed presets are on the roadmap.
