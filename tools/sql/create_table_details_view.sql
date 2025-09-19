create or replace view meta.table_details as
with ids as (
  select distinct table_id from mud.records
),
names as (
  select table_id, label from meta.table_names
),
split as (
  select
    table_id,
    label,
    (regexp_match(label, '^([A-Za-z0-9]+)\.([A-Za-z0-9_]+)$'))[1] as namespace,
    (regexp_match(label, '^([A-Za-z0-9]+)\.([A-Za-z0-9_]+)$'))[2] as name
  from names
),
agg as (
  select table_id,
         count(*)::bigint as rows,
         min(block_number)::bigint as first_block,
         max(block_number)::bigint as latest_block,
         count(distinct address)::bigint as distinct_addresses
  from mud.records
  group by table_id
),
st as (
  select table_id, max(last_update_block)::bigint as last_update_block
  from meta.store_tables_simple
  group by table_id
)
select i.table_id,
       s.label,
       s.namespace,
       s.name,
       a.rows,
       a.first_block,
       a.latest_block,
       a.distinct_addresses,
       st.last_update_block
from ids i
left join split s on s.table_id = i.table_id
left join agg a on a.table_id = i.table_id
left join st  on st.table_id = i.table_id;
