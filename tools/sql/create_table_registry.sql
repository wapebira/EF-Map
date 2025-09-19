create schema if not exists meta;
create table if not exists meta.table_registry (
  table_id bytea primary key,
  label text not null,
  updated_at timestamptz not null default now()
);

-- index for case-insensitive label lookup (optional)
create index if not exists idx_table_registry_label_ci on meta.table_registry (lower(label));
