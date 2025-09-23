# Indexer vs World API – Data Presence Audit (2025-09-18)

Goal: For a specific character address and smart assembly ID, show where they exist in the Primordium chain indexer tables (0x* schemas) vs World API (world_api/*), keeping sources separate to spot duplication or gaps.

Inputs
- Character address: 0x0dc32b8279097967792dc92303ff6ffd338ce231
- Assembly smart_object_id: 63994086827917643456569397617352518577262080062173992510601782164513069228530

## A) Primordium Chain Indexer (0x* schemas)

Checked schemas containing relevant tables: evefrontier__characters_by_acco, evefrontier__characters, evefrontier__smart_assembly, evefrontier__ownership_by_objec, evefrontier__location.

- Schemas with evefrontier__characters_by_acco: 0x0b5f91…, 0x7085f3…, 0x9361e9…, 0x9807a5…, 0x9d86e1…, 0xa54f94…

Findings for the character address (via characters_by_acco → characters):
- 0x7085f3e652987f656fb8dee5aa6592197bb75de8
  - characters_by_acco match: account=0x0dc32b8279097967792dc92303ff6ffd338ce231 → smart_object_id=11165788098012670980088527092814868111731654411553568648068914497340303532061
  - characters: exists=True, tribe_id=98000059, created_at=1755709626
  - ownership_by_object: account owner(s) include 0x0dc32b8279097967792dc92303ff6ffd338ce231 (character and assembly IDs both present as owned by this account)
  - location: assembly smart_object_id located in solar_system_id=30006320 (coords are very large fixed-precision numerics)
- Other listed 0x* schemas: no rows for this address in characters_by_acco; no character rows implied

Findings for the assembly smart_object_id (evefrontier__smart_assembly):
- 0x7085f3e652987f656fb8dee5aa6592197bb75de8
  - smart_assembly: 1 row for smart_object_id, assembly_type=SG, __last_updated_block_number=8146467
- Other listed 0x* schemas: no rows for this smart_object_id

Summary (Indexer): Both the character and the assembly exist only in schema 0x7085f3… for the checked tables. Ownership ties the account to both IDs.

## B) World API (world_api schema)

Tables checked: raw_smartcharacters_details and nested raw_smartcharacters_details__smart_assemblies.

Character address details (raw_smartcharacters_details):
- address=0x0dc32b8279097967792dc92303ff6ffd338ce231
- name=lacal
- id (smart_object_id)=11165788098012670980088527092814868111731654411553568648068914497340303532061
- tribe_id=98000059
- seen in multiple loads (_dlt_id examples: uQI3mI4MagcLmw, CGSXPFb+CXijbg)

Assemblies for this character (nested list):
- No rows found for this character in raw_smartcharacters_details__smart_assemblies in recent loads
- Direct presence check for the target assembly ID in nested assemblies: 0 matches

Summary (World API): World API knows the character (address, name, tribe, smart_object_id) but does not list the specific assembly ID in the per-character nested assemblies feed at this time.

## C) Side-by-side takeaways

- Character: Present in both sources with consistent smart_object_id and tribe_id; indexer adds existence flag and timestamps.
- Assembly: Present in the chain indexer (0x7085f3…) with type=SG and last_updated_block=8146467; not present under the character’s nested assemblies in World API rows checked. This could be timing, filtering, or per-feed coverage difference.
- Ownership: Chain indexer attributes ownership of both the character smart_object_id and the assembly smart_object_id to the queried account.
- Location: Chain indexer has a location row for the assembly (system=30006320), no equivalent in the World API tables queried here.

## D) Queries (provenance)

- Schemas with characters_by_acco: information_schema.tables
- Address → smart_object_id: select from 0x7085f3….evefrontier__characters_by_acco
- Character details: select from 0x7085f3….evefrontier__characters
- Ownership: select from 0x7085f3….evefrontier__ownership_by_objec for both IDs
- Assembly presence: select from 0x7085f3….evefrontier__smart_assembly
- Assembly location: select from 0x7085f3….evefrontier__location for the assembly ID
- World API character details: select from world_api.raw_smartcharacters_details (by lower(address))
- World API nested assemblies: select from world_api.raw_smartcharacters_details__smart_assemblies joined via _dlt_parent_id (no matches) and direct id match (0)

## E) Notes

- The 0x* schema names represent per-world indexer data (Primordium). World API tables (world_api/*) are separate ETL artifacts. This report keeps them separated to avoid intermixing.
- Hex address lookups must use the full 40-char hex (no 0x). Leading zeros matter (the correct hex part here starts with 0d…).
