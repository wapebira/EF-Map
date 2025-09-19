-- List all base tables across non-system schemas
select table_schema, table_name
from information_schema.tables
where table_type='BASE TABLE' and table_schema not in ('pg_catalog','information_schema')
order by 1,2;

-- Columns that could provide names
select table_schema, table_name, column_name
from information_schema.columns
where column_name in ('table_id','tableid','namespace','name','tablename','table_name')
order by 1,2,3;

-- If a mapping table exists
-- try a few common candidates (will error if missing; ignore when running manually):
-- select * from mud.tables limit 10;
-- select * from store.tables limit 10;
-- select * from tables limit 10;
