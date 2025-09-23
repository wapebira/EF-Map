import os
import sys

try:
    import duckdb  # type: ignore
except Exception as e:
    print(f"duckdb module not available in current interpreter: {e}")
    sys.exit(2)


def main(db_path: str) -> int:
    if not os.path.isabs(db_path):
        base = os.path.dirname(os.path.abspath(__file__))
        db_path = os.path.join(base, db_path)

    if not os.path.exists(db_path):
        print(f"DB not found: {db_path}")
        return 1

    con = duckdb.connect(db_path, read_only=True)
    try:
        # List user tables only (exclude information_schema/internal)
        rows = con.execute(
            """
            select table_schema, table_name
            from information_schema.tables
            where table_type = 'BASE TABLE'
              and table_schema not in ('information_schema')
            order by table_schema, table_name
            """
        ).fetchall()

        print(f"Connected: {db_path}")
        print(f"Tables found: {len(rows)}\n")

        interesting = {
            'get_v_2_killmails',
            'get_v_2_smartassemblies',
            'get_v_2_smartassemblies_details',
            'get_v_2_solarsystems',
            'get_v_2_solarsystems_details',
            'get_v_2_types',
            'get_v_2_tribes',
            'get_v_2_tribes_details',
            'get_v_2_smartcharacters',
            'get_v_2_smartcharacters_details',
        }

        # Print counts, prioritizing interesting tables
        counts = []
        for schema, name in rows:
            try:
                cnt = con.execute(f"select count(*) from {schema}.{name}" if schema and schema != 'main' else f"select count(*) from {name}").fetchone()[0]
            except Exception:
                # try quoted fallback
                try:
                    qname = f'"{schema}"."{name}"' if schema and schema != 'main' else f'"{name}"'
                    cnt = con.execute(f"select count(*) from {qname}").fetchone()[0]
                except Exception as e:
                    print(f"Count failed for {schema}.{name}: {e}")
                    continue

            counts.append((schema, name, cnt))

        # Show interesting first, then the rest (top 20)
        print("Row counts (interesting tables first):")
        for schema, name, cnt in sorted(counts, key=lambda r: (0 if r[1] in interesting else 1, r[0], r[1]))[:20]:
            print(f"- {schema}.{name}: {cnt}")

        # Also show any remaining interesting tables not among first 20
        remaining = [c for c in counts if c[1] in interesting]
        if len(remaining) > 20:
            print("\nAdditional interesting tables:")
            for schema, name, cnt in sorted(remaining, key=lambda r: (r[0], r[1]))[20:]:
                print(f"- {schema}.{name}: {cnt}")

        return 0
    finally:
        con.close()


if __name__ == "__main__":
    # Default DB filename used by smoke tests
    db = sys.argv[1] if len(sys.argv) > 1 else "worldapi_pipeline_local.duckdb"
    raise SystemExit(main(db))
