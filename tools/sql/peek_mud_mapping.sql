-- Find candidate mapping tables and their columns
select table_schema, table_name, column_name, data_type
from information_schema.columns
where table_schema not in ('pg_catalog','information_schema')
  and table_name in (
    'store__tables', 'store__resource_ids', 'world__systems', 'world__system_registry',
    'world__namespace_owner', 'world__resource_access'
  )
order by 1,2,3;

-- Show samples if present (safe limits)
-- These will no-op if table missing
do $$ begin
  if to_regclass('"0x"') is null then null; end if; -- placeholder
end $$;
