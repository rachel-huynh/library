// Every Supabase query in the app lives in this module.
// Each function either returns data or throws an Error; callers render the message.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, STORAGE_BUCKET, SIGNED_URL_TTL, PAGE_SIZE } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const KINDS = ['slide', 'lecture', 'note', 'paper', 'book', 'video', 'course', 'other'];
export const STATUSES = ['inbox', 'learning', 'done', 'archived'];
export const LANGS = ['en', 'vi', 'other'];

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Strip diacritics so Vietnamese typed without tone marks still matches. */
export function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

function unwrapList(res) {
  return unwrap(res) ?? [];
}

/** Escape the characters PostgREST treats specially inside an or() filter. */
function escapeFilter(value) {
  return String(value).replace(/[(),]/g, ' ').replace(/%/g, '\\%');
}

// --------------------------------------------------------------------------
// Auth (magic link, single user)
// --------------------------------------------------------------------------

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  return data.session;
}

export async function getUserId() {
  const session = await getSession();
  return session?.user?.id ?? null;
}

export async function signInWithEmail(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

// --------------------------------------------------------------------------
// Topics
// --------------------------------------------------------------------------

export async function listTopics() {
  return unwrapList(
    await supabase.from('topics').select('*').order('sort').order('name_en')
  );
}

export async function createTopic(topic) {
  return unwrap(await supabase.from('topics').insert(topic).select().single());
}

export async function updateTopic(id, patch) {
  return unwrap(await supabase.from('topics').update(patch).eq('id', id).select().single());
}

export async function deleteTopic(id) {
  unwrap(await supabase.from('topics').delete().eq('id', id));
}

/** [{ topic_id, direct_count, total_count }] - subtree counts for the dashboard tree. */
export async function topicCounts() {
  return unwrapList(await supabase.rpc('topic_counts'));
}

/** Turn the flat topic rows into a tree, children sorted by `sort` then name. */
export function buildTopicTree(topics) {
  const byId = new Map(topics.map((t) => [t.id, { ...t, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Ids of a topic and everything below it, for "include subtopics" filtering. */
export function topicSubtreeIds(topics, rootId) {
  const childrenOf = new Map();
  for (const t of topics) {
    if (!childrenOf.has(t.parent_id)) childrenOf.set(t.parent_id, []);
    childrenOf.get(t.parent_id).push(t.id);
  }
  const out = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    out.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

// --------------------------------------------------------------------------
// Items
// --------------------------------------------------------------------------

// Explicit column list: `*` would drag the extracted body (up to 900 kB per row)
// into every list and detail view.
const ITEM_COLUMNS = [
  'id', 'title', 'title_alt', 'lang', 'kind', 'status', 'authors', 'source', 'url',
  'file_path', 'year', 'topic_id', 'rating', 'summary', 'takeaways', 'learned_on',
  'created_at', 'updated_at', 'keywords', 'content_pages', 'content_method', 'extracted_at',
].join(', ');

const ITEM_WITH_RELATIONS =
  `${ITEM_COLUMNS}, topic:topics(id,name_en,name_vi,color), item_tags(tag:tags(id,name))`;

/**
 * Filtered, sorted, paginated list.
 * filters: { topicIds[], kinds[], statuses[], tagIds[], year, minRating, lang }
 * sort:    { column, ascending }
 */
export async function listItems({ filters = {}, sort = {}, page = 0, pageSize = PAGE_SIZE } = {}) {
  let query = supabase.from('items').select(ITEM_WITH_RELATIONS, { count: 'exact' });

  if (filters.topicIds?.length) query = query.in('topic_id', filters.topicIds);
  if (filters.kinds?.length) query = query.in('kind', filters.kinds);
  if (filters.statuses?.length) query = query.in('status', filters.statuses);
  if (filters.langs?.length) query = query.in('lang', filters.langs);
  if (filters.year) query = query.eq('year', filters.year);
  if (filters.minRating) query = query.gte('rating', filters.minRating);
  if (filters.tagIds?.length) {
    const ids = await itemIdsForTags(filters.tagIds);
    if (!ids.length) return { rows: [], count: 0 };
    query = query.in('id', ids);
  }

  const column = sort.column ?? 'updated_at';
  query = query.order(column, { ascending: sort.ascending ?? false, nullsFirst: false });

  const from = page * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []).map(flattenItem), count: count ?? 0 };
}

export async function getItem(id) {
  const data = unwrap(await supabase.from('items').select(ITEM_WITH_RELATIONS).eq('id', id).single());
  return flattenItem(data);
}

export async function createItem(item) {
  return unwrap(await supabase.from('items').insert(item).select().single());
}

export async function updateItem(id, patch) {
  return unwrap(await supabase.from('items').update(patch).eq('id', id).select().single());
}

export async function deleteItem(id) {
  unwrap(await supabase.from('items').delete().eq('id', id));
}

/** Lightweight id/title pairs for the "related material" picker. */
export async function listItemOptions() {
  return unwrapList(await supabase.from('items').select('id, title, title_alt').order('title'));
}

// --------------------------------------------------------------------------
// Extracted document text
// --------------------------------------------------------------------------

/** Items that have an attachment but no extracted text yet. */
export async function itemsAwaitingExtraction() {
  return unwrapList(
    await supabase
      .from('items')
      .select('id, title, file_path, topic_id, summary')
      .not('file_path', 'is', null)
      .is('content', null)
      .order('title')
  );
}

/**
 * Store the text pulled out of an attachment plus what we derived from it.
 * An existing summary is never overwritten - a hand-written one outranks ours.
 */
export async function saveExtraction(itemId, { content, keywords, pages, method, summary }) {
  const patch = {
    content,
    keywords,
    content_pages: pages ?? null,
    content_method: method ?? null,
    extracted_at: new Date().toISOString(),
  };
  if (summary) patch.summary = summary;
  return unwrap(await supabase.from('items').update(patch).eq('id', itemId).select('id').single());
}

export async function keywordCounts(limit = 40) {
  return unwrapList(await supabase.rpc('keyword_counts', { lim: limit }));
}

/** Collapse the nested item_tags shape into a plain `tags` array. */
function flattenItem(row) {
  if (!row) return row;
  const tags = (row.item_tags ?? []).map((link) => link.tag).filter(Boolean);
  const { item_tags, ...rest } = row;
  return { ...rest, tags };
}

// --------------------------------------------------------------------------
// Search
// --------------------------------------------------------------------------

/**
 * websearch_to_tsquery over the unaccented fts column, with an ilike fallback
 * for prefixes and partial words the tsquery misses.
 */
export async function searchItems(query, { limit = 50, offset = 0 } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return { rows: [], mode: 'empty' };

  // The RPC searches titles, authors, summaries and extracted document text,
  // and returns a highlighted snippet from whichever matched.
  const { data, error } = await supabase.rpc('search_items', { q, lim: limit, off: offset });
  if (!error && data?.length) return { rows: data, mode: 'fts' };

  const like = `%${escapeFilter(q)}%`;
  const fallback = unwrapList(
    await supabase
      .from('items')
      .select(ITEM_WITH_RELATIONS)
      .or(
        ['title', 'title_alt', 'authors', 'source', 'summary', 'takeaways']
          .map((col) => `${col}.ilike.${like}`)
          .join(',')
      )
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)
  );
  return { rows: fallback.map(flattenItem), mode: error || !data ? 'ilike' : 'ilike-empty-fts' };
}

// --------------------------------------------------------------------------
// Tags
// --------------------------------------------------------------------------

export async function listTags() {
  return unwrapList(await supabase.from('tags').select('*').order('name'));
}

async function itemIdsForTags(tagIds) {
  const rows = unwrapList(await supabase.from('item_tags').select('item_id').in('tag_id', tagIds));
  return [...new Set(rows.map((r) => r.item_id))];
}

/** Create any tag names that do not exist yet; returns every matching tag row. */
export async function ensureTags(names) {
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!wanted.length) return [];

  const existing = unwrapList(await supabase.from('tags').select('*').in('name', wanted));
  const missing = wanted.filter((n) => !existing.some((t) => t.name === n));
  if (!missing.length) return existing;

  const created = unwrapList(
    await supabase.from('tags').insert(missing.map((name) => ({ name }))).select()
  );
  return [...existing, ...created];
}

/** Replace an item's tags with exactly `names`. */
export async function setItemTags(itemId, names) {
  const tags = await ensureTags(names);
  unwrap(await supabase.from('item_tags').delete().eq('item_id', itemId));
  if (tags.length) {
    unwrap(
      await supabase.from('item_tags').insert(tags.map((t) => ({ item_id: itemId, tag_id: t.id })))
    );
  }
  return tags;
}

// --------------------------------------------------------------------------
// Notes
// --------------------------------------------------------------------------

export async function listNotes(itemId) {
  return unwrapList(
    await supabase.from('notes').select('*').eq('item_id', itemId).order('created_at')
  );
}

export async function createNote(note) {
  return unwrap(await supabase.from('notes').insert(note).select().single());
}

export async function updateNote(id, patch) {
  return unwrap(await supabase.from('notes').update(patch).eq('id', id).select().single());
}

export async function deleteNote(id) {
  unwrap(await supabase.from('notes').delete().eq('id', id));
}

export async function countNotes() {
  const { count, error } = await supabase.from('notes').select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// --------------------------------------------------------------------------
// Related items
// --------------------------------------------------------------------------

export async function listLinks(itemId) {
  return unwrapList(
    await supabase
      .from('item_links')
      .select('relation, to_item, item:items!item_links_to_item_fkey(id,title,kind,status)')
      .eq('from_item', itemId)
  );
}

export async function addLink(fromItem, toItem, relation = 'related') {
  return unwrap(
    await supabase.from('item_links').insert({ from_item: fromItem, to_item: toItem, relation }).select().single()
  );
}

export async function removeLink(fromItem, toItem, relation = 'related') {
  unwrap(
    await supabase
      .from('item_links')
      .delete()
      .eq('from_item', fromItem)
      .eq('to_item', toItem)
      .eq('relation', relation)
  );
}

// --------------------------------------------------------------------------
// Storage (private bucket, signed URLs)
// --------------------------------------------------------------------------

function safeFileName(name) {
  return String(name).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
}

/** Uploads to <uid>/<itemId>/<filename> and returns the stored path. */
export async function uploadFile(itemId, file) {
  const uid = await getUserId();
  if (!uid) throw new Error('Not signed in');
  const path = `${uid}/${itemId}/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return path;
}

export async function signedUrl(path, ttl = SIGNED_URL_TTL) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, ttl);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function removeFile(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

// --------------------------------------------------------------------------
// Dashboard aggregates
// --------------------------------------------------------------------------

async function countItems(match = {}) {
  let query = supabase.from('items').select('id', { count: 'exact', head: true });
  for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function dashboardStats() {
  const [total, learning, done, notes] = await Promise.all([
    countItems(),
    countItems({ status: 'learning' }),
    countItems({ status: 'done' }),
    countNotes(),
  ]);
  return { total, learning, done, notes };
}

/** Minimal rows for the client-side month/kind histograms. */
export async function itemFacets() {
  return unwrapList(
    await supabase.from('items').select('id, kind, status, learned_on, rating, topic_id')
  );
}

export async function currentlyLearning(limit = 10) {
  return unwrapList(
    await supabase
      .from('items')
      .select('id, title, kind, updated_at, topic_id')
      .eq('status', 'learning')
      .order('updated_at', { ascending: false })
      .limit(limit)
  );
}

export async function leastRecentlyRevisited(limit = 10) {
  return unwrapList(
    await supabase
      .from('items')
      .select('id, title, kind, status, updated_at, topic_id')
      .neq('status', 'archived')
      .order('updated_at', { ascending: true })
      .limit(limit)
  );
}
