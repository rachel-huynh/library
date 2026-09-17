-- ============================================================================
-- Edges for the knowledge graph.
-- Run after migration-content.sql (it needs items.keywords). Idempotent.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Topic-to-topic links, weighted by how many extracted keywords two topics
-- share. This is what turns a tree of folders into a connected library:
-- "Overbooking" and "Forecasting" are siblings on paper, but they also share
-- vocabulary, and that shared vocabulary is the edge.
-- ---------------------------------------------------------------------------
create or replace function public.topic_links(min_shared int default 3)
returns table (source uuid, target uuid, shared int, terms text[])
language sql
stable
security invoker
set search_path = public
as $fn$
  with topic_keyword as (
    select distinct i.topic_id as topic_id, k as term
    from public.items i, unnest(i.keywords) as k
    where i.topic_id is not null
  )
  select a.topic_id, b.topic_id, count(*)::int, (array_agg(a.term order by a.term))[1:8]
  from topic_keyword a
  join topic_keyword b on a.term = b.term and a.topic_id < b.topic_id
  group by a.topic_id, b.topic_id
  having count(*) >= min_shared
  order by count(*) desc
$fn$;

-- ---------------------------------------------------------------------------
-- Explicit item_links rolled up to the topic level, so a "related material"
-- relation between two documents also shows as a line between their topics.
-- ---------------------------------------------------------------------------
create or replace function public.topic_relation_links()
returns table (source uuid, target uuid, relations int)
language sql
stable
security invoker
set search_path = public
as $fn$
  select
    least(f.topic_id, t.topic_id)    as source,
    greatest(f.topic_id, t.topic_id) as target,
    count(*)::int                    as relations
  from public.item_links l
  join public.items f on f.id = l.from_item
  join public.items t on t.id = l.to_item
  where f.topic_id is not null
    and t.topic_id is not null
    and f.topic_id <> t.topic_id
  group by 1, 2
$fn$;
