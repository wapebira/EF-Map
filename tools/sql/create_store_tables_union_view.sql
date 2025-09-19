-- Create a simple union view over any <schema>.store__tables found in the DB.
-- Exposes table_id and last schema update block.
create schema if not exists meta;

do $body$
declare
  v_sql text;
begin
  v_sql := (
    select string_agg(
      format('select table_id, %L as schema_name, __last_updated_block_number::bigint as last_update_block from %I.store__tables', t.table_schema, t.table_schema),
      ' union all '
    )
    from information_schema.tables t
    where t.table_name = 'store__tables'
      and t.table_schema not in ('pg_catalog','information_schema')
  );

  if v_sql is null then
    -- No store__tables present; create an empty view to keep queries simple
    execute 'create or replace view meta.store_tables_simple as select null::bytea as table_id, null::text as schema_name, null::bigint as last_update_block where false';
  else
    execute 'create or replace view meta.store_tables_simple as ' || v_sql;
  end if;
end $body$;
