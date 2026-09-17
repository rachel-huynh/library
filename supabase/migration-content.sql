-- ============================================================================
-- Full-text over extracted PDF content.
-- Run in the Supabase SQL Editor AFTER schema.sql. Idempotent.
--
-- Adds items.content (text pulled out of the attachment) and items.keywords,
-- folds content into the fts vector, and gives search_items a snippet.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------
alter table public.items add column if not exists content       text;
alter table public.items add column if not exists keywords      text[];
alter table public.items add column if not exists content_pages int;
alter table public.items add column if not exists content_method text
  check (content_method is null or content_method in ('text-layer', 'ocr', 'mixed', 'manual'));
alter table public.items add column if not exists extracted_at  timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Rebuild the tsvector so it also covers the document body.
--    The generated column has to be dropped before the function can change.
-- ---------------------------------------------------------------------------
drop index if exists items_fts_idx;
alter table public.items drop column if exists fts;

create or replace function public.library_tsvector(
  p_title     text,
  p_title_alt text,
  p_summary   text,
  p_takeaways text,
  p_authors   text,
  p_content   text
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
    ||
    -- The body is the bulkiest and least precise signal, so it ranks last.
    setweight(to_tsvector('simple', public.immutable_unaccent(
      left(coalesce(p_content, ''), 900000))), 'D')
$fn$;

alter table public.items add column fts tsvector generated always as (
  public.library_tsvector(title, title_alt, summary, takeaways, authors, content)
) stored;

create index items_fts_idx on public.items using gin (fts);

-- The five-argument version is now unused.
drop function if exists public.library_tsvector(text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- 3. search_items: ranked hits with a highlighted snippet.
--    Returns display columns rather than the whole row, so a 900 kB body is
--    never shipped to the browser just to draw a result list.
-- ---------------------------------------------------------------------------
drop function if exists public.search_items(text, int, int);

create or replace function public.search_items(q text, lim int default 50, off int default 0)
returns table (
  id         uuid,
  title      text,
  title_alt  text,
  kind       text,
  status     text,
  lang       text,
  topic_id   uuid,
  year       int,
  rating     int,
  summary    text,
  keywords   text[],
  file_path  text,
  updated_at timestamptz,
  snippet    text,
  rank       real
)
language sql
stable
security invoker
set search_path = public, extensions
as $fn$
  with q as (
    select websearch_to_tsquery('simple', public.immutable_unaccent($1)) as tsq
  )
  select
    i.id, i.title, i.title_alt, i.kind, i.status, i.lang, i.topic_id,
    i.year, i.rating, i.summary, i.keywords, i.file_path, i.updated_at,
    -- Headline runs over the unaccented body, so a Vietnamese snippet comes
    -- back without tone marks. Acceptable: the highlight is what matters.
    ts_headline(
      'simple',
      public.immutable_unaccent(coalesce(i.content, i.summary, i.title)),
      q.tsq,
      'StartSel=<<,StopSel=>>,MaxWords=38,MinWords=18,MaxFragments=2,FragmentDelimiter= ... '
    ) as snippet,
    ts_rank(i.fts, q.tsq) as rank
  from public.items i, q
  where i.fts @@ q.tsq
  order by rank desc, i.updated_at desc
  limit $2 offset $3
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Corpus-wide keyword rollup, for the dashboard.
-- ---------------------------------------------------------------------------
create or replace function public.keyword_counts(lim int default 40)
returns table (keyword text, uses bigint)
language sql
stable
security invoker
set search_path = public
as $fn$
  select k as keyword, count(*) as uses
  from public.items i, unnest(i.keywords) as k
  group by k
  order by uses desc, k
  limit lim
$fn$;
