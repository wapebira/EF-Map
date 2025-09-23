import sys, sqlite3, json, os

def main(db_path: str, out_dir: str):
    os.makedirs(out_dir, exist_ok=True)
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    cur.execute("SELECT id, uid, title, version, is_folder, folder_id, created, updated FROM dashboard ORDER BY id")
    dashboards = [dict(r) for r in cur.fetchall()]
    print(f"dashboards: {len(dashboards)}")
    for d in dashboards:
        print(f"- id={d['id']} uid={d['uid']} title={d['title']} v={d['version']} folder_id={d['folder_id']}")
        cur.execute("SELECT data FROM dashboard WHERE id=?", (d['id'],))
        data = cur.fetchone()[0]
        if isinstance(data, (bytes, bytearray)):
            try:
                data = data.decode('utf-8')
            except Exception:
                data = data.decode('latin-1', errors='replace')
        out_path = os.path.join(out_dir, f"dashboard_{d['id']}_{d['uid'] or 'no_uid'}.json")
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(data)
    # versions summary
    cur.execute("SELECT dashboard_id, version, created, ifnull(message,'') AS msg FROM dashboard_version ORDER BY dashboard_id, version")
    vers = [dict(r) for r in cur.fetchall()]
    with open(os.path.join(out_dir, 'versions.json'), 'w', encoding='utf-8') as f:
        json.dump(vers, f, ensure_ascii=False, indent=2, default=str)
    print(f"wrote JSON to {out_dir}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python dump_dashboards.py <grafana.db> [out_dir]")
        sys.exit(1)
    db = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(db), 'dash_dump')
    main(db, out_dir)
