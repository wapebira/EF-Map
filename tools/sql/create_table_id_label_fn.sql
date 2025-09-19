-- Creates meta.table_id_to_label(table_id bytea) -> text
-- Heuristic: decode printable ASCII from table_id; extract patterns like 'tbworld'/'tbstore' and trailing CamelCase name; fallback to hex.
create schema if not exists meta;

create or replace function meta.table_id_to_label(p_id bytea)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      -- remove octal escapes (e.g., \000), strip non-ascii, map common prefixes to namespace.
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(encode(p_id,'escape'), E'\\\\[0-9]{3}', '', 'g'),
            '[^A-Za-z0-9_.]', '', 'g'
          ),
          '^tbworld', 'world.'
        ),
        '^tbstore', 'store.'
      ),
      ''
    ),
    encode(p_id,'hex')
  );
$$;
