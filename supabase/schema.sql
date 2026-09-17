-- ============================================================================
-- Knowledge Library - database schema
-- Run once in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensions and helper functions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "unaccent" with schema extensions;
create extension if not exists "pg_trgm" with schema extensions;

-- `if not exists` does nothing when an extension is already installed elsewhere,
-- so never assume it sits in `extensions` - list both schemas everywhere instead.
set search_path = public, extensions;

-- unaccent() is STABLE, but generated columns require an IMMUTABLE expression.
-- The pinned search_path makes this wrapper deterministic, so marking it
-- immutable is safe.
create or replace function public.immutable_unaccent(text)
returns text
language sql
immutable
strict
parallel safe
set search_path = public, extensions, pg_catalog
as $fn$
  select unaccent($1)
$fn$;

-- Diacritic-insensitive tsvector builder used by items.fts.
create or replace function public.library_tsvector(
  p_title     text,
  p_title_alt text,
  p_summary   text,
  p_takeaways text,
  p_authors   text
)
returns tsvector
language sql
immutable
parallel safe
as $fn$
  select
    setweight(to_tsvector('simple', public.immutable_unaccent(
      coalesce(p_title, '') || ' ' || coalesce(p_title_alt, ''))), 'A')
    ||
    setweight(to_tsvector('simple', public.immutable_unaccent(
      coalesce(p_authors, ''))), 'B')
    ||
    setweight(to_tsvector('simple', public.immutable_unaccent(
      coalesce(p_summary, '') || ' ' || coalesce(p_takeaways, ''))), 'C')
$fn$;

-- Shared updated_at trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- Domain > Topic > Subtopic (2-3 levels, enforced by convention, not by DDL).
create table if not exists public.topics (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name_en    text not null,
  name_vi    text,
  parent_id  uuid references public.topics(id) on delete cascade,
  slug       text not null,
  color      text,
  sort       int  not null default 0,
  created_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null,
  title_alt  text,
  lang       text not null default 'en'    check (lang   in ('en','vi','other')),
  kind       text not null default 'other' check (kind   in ('slide','lecture','note','paper','book','video','course','other')),
  status     text not null default 'inbox' check (status in ('inbox','learning','done','archived')),
  authors    text,
  source     text,
  url        text,
  file_path  text,
  year       int  check (year is null or year between 1000 and 2999),
  topic_id   uuid references public.topics(id) on delete set null,
  rating     int  check (rating is null or rating between 1 and 5),
  summary    text,
  takeaways  text,
  learned_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fts tsvector generated always as (
    public.library_tsvector(title, title_alt, summary, takeaways, authors)
  ) stored
);

drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

create table if not exists public.tags (
  id       uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name     text not null,
  unique (owner_id, name)
);

create table if not exists public.item_tags (
  item_id uuid not null references public.items(id) on delete cascade,
  tag_id  uuid not null references public.tags(id)  on delete cascade,
  primary key (item_id, tag_id)
);

-- Notes / highlights anchored by page number or video timestamp (locator).
create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items(id) on delete cascade,
  body       text not null,
  locator    text,
  created_at timestamptz not null default now()
);

create table if not exists public.item_links (
  from_item uuid not null references public.items(id) on delete cascade,
  to_item   uuid not null references public.items(id) on delete cascade,
  relation  text not null default 'related',
  primary key (from_item, to_item, relation),
  check (from_item <> to_item)
);

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------
create index if not exists items_fts_idx        on public.items using gin (fts);
create index if not exists items_topic_id_idx   on public.items (topic_id);
create index if not exists items_kind_idx       on public.items (kind);
create index if not exists items_status_idx     on public.items (status);
create index if not exists items_learned_on_idx on public.items (learned_on);
create index if not exists items_owner_idx      on public.items (owner_id);
create index if not exists items_updated_at_idx on public.items (updated_at);
create index if not exists items_year_idx       on public.items (year);
create index if not exists items_rating_idx     on public.items (rating);
create index if not exists topics_parent_idx    on public.topics (parent_id);
create index if not exists topics_owner_idx     on public.topics (owner_id);
create index if not exists item_tags_tag_idx    on public.item_tags (tag_id);
create index if not exists notes_item_idx       on public.notes (item_id);
create index if not exists item_links_to_idx    on public.item_links (to_item);

-- Trigram index backing the diacritic-insensitive ilike search fallback.
create index if not exists items_title_trgm_idx
  on public.items using gin (public.immutable_unaccent(title) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 4. Row Level Security - single user, everything scoped to auth.uid()
-- ---------------------------------------------------------------------------
alter table public.topics     enable row level security;
alter table public.items      enable row level security;
alter table public.tags       enable row level security;
alter table public.item_tags  enable row level security;
alter table public.notes      enable row level security;
alter table public.item_links enable row level security;

drop policy if exists topics_owner on public.topics;
create policy topics_owner on public.topics
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists items_owner on public.items;
create policy items_owner on public.items
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists tags_owner on public.tags;
create policy tags_owner on public.tags
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Child tables: ownership is derived through items.
drop policy if exists item_tags_owner on public.item_tags;
create policy item_tags_owner on public.item_tags
  for all to authenticated
  using (exists (select 1 from public.items i where i.id = item_id and i.owner_id = auth.uid()))
  with check (exists (select 1 from public.items i where i.id = item_id and i.owner_id = auth.uid()));

drop policy if exists notes_owner on public.notes;
create policy notes_owner on public.notes
  for all to authenticated
  using (exists (select 1 from public.items i where i.id = item_id and i.owner_id = auth.uid()))
  with check (exists (select 1 from public.items i where i.id = item_id and i.owner_id = auth.uid()));

drop policy if exists item_links_owner on public.item_links;
create policy item_links_owner on public.item_links
  for all to authenticated
  using (
    exists (select 1 from public.items i where i.id = from_item and i.owner_id = auth.uid())
    and exists (select 1 from public.items i where i.id = to_item and i.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.items i where i.id = from_item and i.owner_id = auth.uid())
    and exists (select 1 from public.items i where i.id = to_item and i.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 5. Storage - private bucket `library`, objects stored under <auth.uid()>/...
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('library', 'library', false)
on conflict (id) do nothing;

drop policy if exists library_owner_read   on storage.objects;
drop policy if exists library_owner_write  on storage.objects;
drop policy if exists library_owner_update on storage.objects;
drop policy if exists library_owner_delete on storage.objects;

create policy library_owner_read on storage.objects
  for select to authenticated
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);

create policy library_owner_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);

create policy library_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);

create policy library_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 6. RPC helpers called from db.js
-- ---------------------------------------------------------------------------

-- Full-text search. RLS still applies (security invoker).
-- Client call: supabase.rpc('search_items', { q, lim, off })
create or replace function public.search_items(q text, lim int default 50, off int default 0)
returns setof public.items
language sql
stable
security invoker
set search_path = public, extensions
as $fn$
  select i.*
  from public.items i
  where i.fts @@ websearch_to_tsquery('simple', public.immutable_unaccent(q))
  order by ts_rank(i.fts, websearch_to_tsquery('simple', public.immutable_unaccent(q))) desc,
           i.updated_at desc
  limit lim offset off
$fn$;

-- Item counts per topic branch: direct children of the topic and the whole subtree.
-- Client call: supabase.rpc('topic_counts')
create or replace function public.topic_counts()
returns table (topic_id uuid, direct_count bigint, total_count bigint)
language sql
stable
security invoker
set search_path = public
as $fn$
  with recursive direct as (
    select t.id, count(i.id) as c
    from public.topics t
    left join public.items i on i.topic_id = t.id
    group by t.id
  ),
  descend as (
    select t.id as root, t.id as node from public.topics t
    union all
    select d.root, c.id from descend d join public.topics c on c.parent_id = d.node
  )
  select d.root,
         max(dir.c) filter (where d.node = d.root) as direct_count,
         sum(dir2.c) as total_count
  from descend d
  join direct dir  on dir.id  = d.root
  join direct dir2 on dir2.id = d.node
  group by d.root
$fn$;
