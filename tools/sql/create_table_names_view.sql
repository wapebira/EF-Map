do $body$
declare
  v_store_union text;
begin
  -- If mud.tables exists, trust it directly
  if to_regclass('mud.tables') is not null then
    execute 'create or replace view meta.table_names as select table_id, (namespace || ''.'' || name) as label from mud.tables';
    return;
  end if;

  -- Build union for any <schema>.store__tables (optional, used as tertiary source)
  v_store_union := (
    select string_agg(
      format(
        $$select table_id,
              nullif(regexp_replace(regexp_replace(encode(abi_encoded_key_names,'escape'), E'\\\\[0-9]{3}', '', 'g'), '[^A-Za-z_.]','','g'),'') as label
          from %I.store__tables$$,
        c.table_schema
      ),
      ' union all '
    )
    from (
      select table_schema
      from information_schema.tables
      where table_name='store__tables'
        and table_schema not in ('pg_catalog','information_schema')
    ) c
  );

  -- Preferred composite view: registry > computed-from-id > store__tables > hex
  if to_regclass('mud.records') is not null then
    execute coalesce(
      'create or replace view meta.table_names as '
      || 'with ids as (select distinct table_id from mud.records), '
      || 'reg as (select table_id, label from meta.table_registry), '
      || 'lab as (select table_id, meta.table_id_to_label(table_id) as label from ids) '
      || case when v_store_union is not null then ', st as (' || v_store_union || ')' else '' end || ' '
      || 'select i.table_id, '
      || '  coalesce(reg.label, lab.label, ' || case when v_store_union is not null then 's.label, ' else '' end || 'encode(i.table_id,''hex'')) as label '
      || 'from ids i '
      || 'left join reg on reg.table_id = i.table_id '
      || 'left join lab on lab.table_id = i.table_id '
      || case when v_store_union is not null then 'left join st s on s.table_id = i.table_id ' else '' end
    , '');
    return;
  end if;

  -- If no mud.records, fallback to registry only
  execute 'create or replace view meta.table_names as select table_id, label from meta.table_registry';
end $body$ language plpgsql;
