# Universe Data Pipeline (Including Stations)

Purpose: Document the exact steps and files required to regenerate the frontend SQLite database (`map_data_v2.db`) from fresh game exports when a new universe is released.

## Source Inputs (Game Export Artifacts)
Place these at repository root (overwrite existing):
- `stellar_systems.json`
- `stellar_regions.json`
- `stellar_constellations.json`
- `labels.json`
- `mapobjects.db` (new – contains station & planetary raw data; not committed if proprietary)

Optional legacy JSONs (retain for completeness):
- `stellar_cartography.json`, `stellar_labels.json`, etc. (only if scripts still reference them — current pipeline uses the four above).

## Generated Output
- `eve-frontier-map/public/map_data_v2.db` – consumed by the web client.
  - Tables: `regions`, `constellations`, `systems`, `stargates`, `labels`, `region_labels`, `stations`.
  - `stations` is additive; absence simply means the frontend shows no station icons.

## Regeneration Steps
1. Acquire fresh game JSON + `mapobjects.db` for the new universe.
2. Copy them into the repo root, replacing old files.
3. Run (from repo root):
   ```bash
   python create_map_data.py
   ```
   (Optionally run `python filter_map_data.py` if future filters or pruning logic extends there.)
4. Verify that `eve-frontier-map/public/map_data_v2.db` was updated (timestamp change, size likely > previous version if more stations).
5. Start dev server to smoke test:
   ```bash
   cd eve-frontier-map
   npm run dev
   ```
6. Load app in browser: confirm map loads, toggle "Stations" panel (if station icon file present) to see icons.
7. Commit JSON changes (if license allows) but **exclude** `mapobjects.db` if proprietary or large. Add / confirm `.gitignore` entry if needed.

## Cache Busting Policy
- Increment filename when schema changes or downstream clients must fetch a fresh asset. Current: `map_data_v2.db`.
- Next bump example: `map_data_v3.db` (update both `create_map_data.py` output name and fetch path in `App.tsx`).
- Do NOT bump for purely additive rows unless clients previously cached stale values and the change must be mandatory for correctness.

## Station Table Discovery Logic
- Script scans `mapobjects.db` for any table name containing `station`.
- Chooses the first table having a column in (`system_id`, `solar_system_id`, `solarsystemid`, `solarsystem_id`, `solarsystem`).
- Aggregates counts: `SELECT <col> as sid, COUNT(*) FROM <table> GROUP BY <col>` → inserts into `stations` table.
- If no table matches, generation proceeds without stations (non-fatal).

## Frontend Consumption
- On load, app issues `SELECT system_id, station_count FROM stations`.
- Populates `window.__efStations = { ids:Set<number>, counts: Record<number,number> }`.
- Sprite icons created only when user enables the Stations toggle (persisted in prefs under `showStations`).

## Adding Future Data (Example: Outposts or Resources)
1. Add new table creation to `create_database_schema`.
2. Integrate extraction after filtering section (before final commit) similar to stations block.
3. Bump DB filename only if the frontend logic requires guaranteed refresh.
4. Extend docs here with new table purpose and column list.

## Quality Checklist After Regeneration
- [ ] App loads without console errors.
- [ ] Systems count stable vs expected universe size.
- [ ] Routing still functional (quick test 2–3 routes).
- [ ] Station icons appear only for expected systems.
- [ ] Performance unaffected (no perceptible frame drop when toggling stations).

## Troubleshooting
| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| No station icons | `mapobjects.db` missing or station table not detected | Confirm file path & table name contains 'station'; rerun script |
| Old DB still used | Browser cache of previous filename | Verify fetch path updated; confirm network tab requests `map_data_v2.db` |
| Icons huge/small | Source PNG too large/small | Replace `station.png` (32–64px recommended), the code scales to 6 units |
| Build fails after bump | Forgot to update fetch path | Ensure `App.tsx` uses new filename |

## Version History
- v2: Added `stations` table + filename bump → `map_data_v2.db`.

(End)
