-- List mud tables
select 'TABLES' as section, table_name from information_schema.tables where table_schema='mud' and table_type='BASE TABLE' order by table_name;

-- Columns for mud.records and mud.config if present
select 'COLUMNS' as section, table_name, column_name, data_type from information_schema.columns where table_schema='mud' and table_name in ('records','config') order by table_name, ordinal_position;

-- Heuristic: find columns that look like block number across mud schema
select 'BLOCK_COLS' as section, table_name, column_name, data_type from information_schema.columns where table_schema='mud' and (column_name ilike '%block%' or column_name ilike '%height%') order by table_name, column_name;

-- Sample: max block candidates if columns exist
-- (These will error if tables/cols not present; run manually as needed)
-- select max(block_number) from mud.records;
-- select max(blocknumber)  from mud.records;
