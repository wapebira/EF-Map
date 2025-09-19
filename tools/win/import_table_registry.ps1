Param(
  [string]$Csv = "..\sql\table_registry_seed.csv",
  [string]$Container = 'pg-indexer-reader-postgres-1'
)

$ErrorActionPreference = 'Stop'

if (!(Test-Path $Csv)) { throw "CSV not found: $Csv" }

$tempSql = Join-Path $env:TEMP ("seed_table_registry_" + [guid]::NewGuid().ToString() + ".sql")

@"
create schema if not exists meta;
create table if not exists meta.table_registry (
  table_id bytea primary key,
  label text not null,
  updated_at timestamptz not null default now()
);

-- staging table
drop table if exists meta._seed;
create table meta._seed(table_id_hex text, label text);
"@ | Out-File -Encoding utf8 $tempSql

# Append COPY from stdin block
Add-Content -Encoding utf8 $tempSql "COPY meta._seed FROM STDIN WITH (FORMAT csv, HEADER true);"
Get-Content $Csv | Add-Content -Encoding utf8 $tempSql
Add-Content -Encoding utf8 $tempSql "\n\\.\n"

# Upsert into registry
Add-Content -Encoding utf8 $tempSql @"
insert into meta.table_registry(table_id,label)
select decode(regexp_replace(table_id_hex, '^0x', ''), 'hex') as table_id, label
from meta._seed s
where coalesce(nullif(trim(label),''), '') <> ''
on conflict (table_id) do update set label=excluded.label, updated_at=now();

drop table meta._seed;
"@

Write-Host "Importing labels into meta.table_registry from $Csv ..."
docker cp $tempSql ${Container}:/tmp/seed_table_registry.sql | Out-Null
docker exec $Container bash -lc "psql -U user -d postgres -f /tmp/seed_table_registry.sql" | Write-Host
Remove-Item $tempSql -Force
Write-Host "Done."
