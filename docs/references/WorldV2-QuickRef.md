# World v2 Quick Reference (EVE Frontier)

Purpose: Curate the most relevant blockchain/MUD concepts and practical query/utility recipes for EF-Map. Use this when implementing features that touch on chain data, contract tables, or indexer queries.

Sources
- World v2 Functionality Outline: https://metalyth.org/posts/World-v2-Functionality-Outline
- World Contracts Recipe Book: https://metalyth.org/posts/World-Contracts-Recipe-Book
- Terminology: https://metalyth.org/posts/Terminology

EF-Map context (as of 2025-09-20)
- Hosting/runtime: Cloudflare Pages + Worker; KV for shares/stats/snapshots.
- Chain: Pyrope. World address and deploy block recorded in decision log (see “Current Environment Quick Reference”).
- Ingestion: Primordium pg-indexer → Postgres (local) → snapshots to KV for site overlays; Grafana is the canonical dashboard.

Key terms (very short)
- EVM: Deterministic execution of Solidity bytecode; gas metering.
- MUD World: Set of Systems + Tables defining the on-chain game world (EVE Frontier’s world in world-chain-contracts).
- Tables: Structured storage. On‑chain (persisted state). Off‑chain (event logs → indexer, cheaper gas; handled by MUD Indexer).
- Systems: Contract logic permitted to read/write MUD Tables per access control.
- Smart Assembly: Deployed in‑game structure (SSU, Smart Gate, etc.).
- Identities: account (EOA) and smartObjectId (on‑chain ID for assemblies/characters/items).

Practical lookups (read-only)
Characters
- Address → characterId: table `evefrontier__CharactersByAcc` (indexer/explorer)
- characterId → name/metadata: table `evefrontier__EntityRecordMeta`
- characterId → tribeId: table `evefrontier__Characters`

Ownership
- smartObjectId → owner account: table `evefrontier__OwnershipByObjec`

Metadata
- smartObjectId → assemblyType: table `evefrontier__SmartAssembly` (types include NWN, manufacturing, smart_hangar, SSU, …)
- smartObjectId → 3D location: table `evefrontier__Location` (solarSystemId, x, y, z)

Items
- typeId → item smartObjectId: ObjectIdLib.calculateObjectId(tenantId, typeId)
  - Tenant ID constant example (bytes32): `0xaef2…1fee5` (see Recipe Book). Validate against current chain.

TableId utilities (when you need to derive or verify table IDs)
- Solidity: ResourceIdLib.encode({ typeId: RESOURCE_TABLE | RESOURCE_OFFCHAIN_TABLE, name })
- JS (concept): pack 2‑byte type + 30‑byte name (first 14 bytes = namespace, last 16 = table name). Reverse by slicing padded bytes.

MUD Explorer example (Pyrope world)
- Explorer base (example): https://explorer.mud.dev/pyrope/worlds/<WORLD_ADDRESS>/explore
- Prebuilt queries in Recipe Book link directly to EVE Frontier tables.

How this maps to EF-Map
- Our site prefers precomputed snapshots for overlays (e.g., Smart Gate links, System overlays) stored in KV; dynamic queries and auth views will come later per “Data Exposure Plan”.
- When we need on-chain context for UI (ownership, types, locations), prefer:
  1) Local Postgres (Primordium pg-indexer decoded tables) via Grafana/queries;
  2) Fallback: MUD Explorer links for one-off verification;
  3) For code: small maintenance scripts under `tools/` that hit our Postgres or use Explorer/World API as needed.

Contracts/Solidity snippets (for reference only; do not paste secrets)
- Read from a generated table in Solidity:
  - `import { Characters } from "@eveworld/world-v2/src/namespaces/evefrontier/codegen/tables/Characters.sol";`
  - `uint256 tribeId = Characters.getTribeId(characterId);`
- JS utility idea (tableId encode/decode) exists in Recipe Book; reuse patterns if we add tooling.

Access control & inventories (future UI relevance)
- OwnershipSystem / AccessSystem govern who may interact with a Smart Assembly.
- Primary vs Ephemeral inventory transfer functions exist (EphemeralInteractSystem), enabling player ↔ assembly item flows; record shapes useful for market/log UIs.

Do/Don’t for EF-Map
- Do link to this quick ref from developer docs and assistant instructions.
- Do keep world address, chain, and deploy block in the decision log, not duplicated here.
- Don’t reintroduce Netlify endpoints or assume on‑chain writes from the site; our stack is read‑heavy and snapshot-first.

Appendix: Direct links
- Address → CharacterId: CharactersByAcc (link in Recipe Book)
- Character metadata: EntityRecordMeta (link in Recipe Book)
- OwnershipByObjec: Owner by smartObjectId (link in Recipe Book)
- SmartAssembly type & Location: links in Recipe Book
