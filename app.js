// Application shell and screen controllers: boot, auth gate, hash routing,
// language switching, keyboard shortcuts, data fetching, and event wiring.
// All DOM construction lives in ui.js; all Supabase access lives in db.js.

import { SUPABASE_URL, SUPABASE_ANON_KEY, PAGE_SIZE } from './config.js';
import * as db from './db.js';
import { t, getLang, setLang, onLangChange, applyTranslations, formatMonth } from './i18n.js';
import {
  $, $$, el, clear, loadingNode, errorNode, toast, closeModal, isModalOpen,
  libraryFilters, pagination, itemList, itemDetail, itemForm, searchScreen,
  statTiles, topicTree, columnChart, barChart, compactList, topicManager, openModal,
  itemTitle, topicName,
} from './ui.js';

// --------------------------------------------------------------------------
// Routing
// --------------------------------------------------------------------------

/** '#/item/abc' -> { name: 'item', param: 'abc' } */
export function parseRoute(hash = window.location.hash) {
  const [name = 'dashboard', param = ''] = hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'dashboard', param: decodeURIComponent(param) };
}

export function navigate(path) {
  window.location.hash = path.startsWith('#') ? path : `#${path}`;
}

const SCREENS = {};

export function registerScreen(name, renderer) {
  SCREENS[name] = renderer;
}

let renderToken = 0;
let pendingSearchFocus = false;

async function renderRoute() {
  const route = parseRoute();
  const mount = $('#screen');
  const token = ++renderToken;

  $$('.nav-link').forEach((link) => {
    if (link.dataset.route === route.name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  clear(mount).append(loadingNode());

  const render = SCREENS[route.name] ?? SCREENS.dashboard;
  try {
    const fragment = document.createDocumentFragment();
    await render(fragment, route);
    if (token !== renderToken) return; // a newer navigation won the race
    clear(mount).append(fragment);
  } catch (error) {
    if (token !== renderToken) return;
    clear(mount).append(errorNode(error, renderRoute));
  }

  if (pendingSearchFocus) {
    pendingSearchFocus = false;
    $('#search-input')?.focus();
  }
  window.scrollTo({ top: 0 });
}

// --------------------------------------------------------------------------
// Cached reference data (topics / tags / item titles)
// --------------------------------------------------------------------------

const cache = { topics: null, tags: null, itemOptions: null };

const getTopics = () => (cache.topics ??= db.listTopics());
const getTags = () => (cache.tags ??= db.listTags());
const getItemOptions = () => (cache.itemOptions ??= db.listItemOptions());

function invalidate(...keys) {
  for (const key of keys.length ? keys : Object.keys(cache)) cache[key] = null;
}

const topicIndex = (topics) => new Map(topics.map((topic) => [topic.id, topic]));

function topicBreadcrumb(topics, topicId) {
  const byId = topicIndex(topics);
  const trail = [];
  let node = byId.get(topicId);
  while (node) {
    trail.unshift(topicName(node));
    node = node.parent_id ? byId.get(node.parent_id) : null;
  }
  return trail;
}

// --------------------------------------------------------------------------
// Library screen
// --------------------------------------------------------------------------

const emptyFilters = () => ({
  topic: '',
  includeSubtopics: true,
  kinds: [],
  statuses: [],
  langs: [],
  tagIds: [],
  year: null,
  minRating: null,
});

const libraryState = {
  filters: emptyFilters(),
  sort: { column: 'updated_at', ascending: false },
  view: 'table',
  page: 0,
};

function queryFilters(topics) {
  const { topic, includeSubtopics, ...rest } = libraryState.filters;
  const topicIds = topic
    ? includeSubtopics === false
      ? [topic]
      : db.topicSubtreeIds(topics, topic)
    : [];
  return { ...rest, topicIds };
}

registerScreen('library', async (mount) => {
  const [topics, tags] = await Promise.all([getTopics(), getTags()]);
  const { rows, count } = await db.listItems({
    filters: queryFilters(topics),
    sort: libraryState.sort,
    page: libraryState.page,
    pageSize: PAGE_SIZE,
  });

  const applyState = (next) => {
    Object.assign(libraryState, next);
    renderRoute();
  };

  mount.append(
    el('div', { class: 'screen-head' }, el('h1', {}, t('library.title'))),
    libraryFilters({
      topics,
      tags,
      state: libraryState,
      onChange: applyState,
      onClear: () => applyState({ filters: emptyFilters(), page: 0 }),
    }),
    itemList(rows, { view: libraryState.view, topicsById: topicIndex(topics) }),
    pagination({
      page: libraryState.page,
      pageSize: PAGE_SIZE,
      count,
      onPage: (page) => applyState({ page }),
    })
  );
});

// --------------------------------------------------------------------------
// Search screen
// --------------------------------------------------------------------------

const searchState = { query: '' };

registerScreen('search', async (mount) => {
  const topics = await getTopics();
  const topicsById = topicIndex(topics);

  const run = async (raw) => {
    const query = String(raw ?? '');
    searchState.query = query;
    if (!query.trim()) {
      clear(results);
      return;
    }
    clear(results).append(loadingNode());
    try {
      const { rows, mode } = await db.searchItems(query);
      clear(results).append(
        mode.startsWith('ilike') ? el('p', { class: 'small muted' }, t('search.fallback')) : null,
        itemList(rows, { view: 'cards', query, topicsById, emptyKey: 'search.empty' })
      );
    } catch (error) {
      clear(results).append(errorNode(error, () => run(query)));
    }
  };

  const { node, results } = searchScreen({ initialQuery: searchState.query, onQuery: run });
  mount.append(node);
  if (searchState.query.trim()) run(searchState.query);
});

// --------------------------------------------------------------------------
// Item detail
// --------------------------------------------------------------------------

registerScreen('item', async (mount, route) => {
  const id = route.param;
  if (!id) return navigate('/library');

  const [item, notes, links, topics, itemOptions] = await Promise.all([
    db.getItem(id),
    db.listNotes(id),
    db.listLinks(id),
    getTopics(),
    getItemOptions(),
  ]);
  const fileUrl = item.file_path ? await db.signedUrl(item.file_path) : null;

  const refresh = () => renderRoute();

  mount.append(
    itemDetail(
      {
        item,
        notes,
        links,
        fileUrl,
        breadcrumb: topicBreadcrumb(topics, item.topic_id),
      },
      {
        itemOptions: itemOptions.map((option) => ({ id: option.id, title: itemTitle(option) })),
        onKeyword: (word) => {
          searchState.query = word;
          navigate('/search');
        },
        onAddNote: async (note) => {
          await db.createNote({ ...note, item_id: id });
          refresh();
        },
        onUpdateNote: async (note, patch) => {
          await db.updateNote(note.id, patch);
          refresh();
        },
        onDeleteNote: async (note) => {
          await db.deleteNote(note.id);
          refresh();
        },
        onDeleteItem: async () => {
          if (item.file_path) await db.removeFile(item.file_path).catch(() => {});
          await db.deleteItem(item.id);
          invalidate('itemOptions');
          toast(t('common.delete'));
          navigate('/library');
        },
        onAddLink: async (toItem) => {
          await db.addLink(id, toItem);
          refresh();
        },
        onRemoveLink: async (link) => {
          await db.removeLink(id, link.to_item, link.relation);
          refresh();
        },
      }
    )
  );
});

// --------------------------------------------------------------------------
// Add / edit
// --------------------------------------------------------------------------

async function renderForm(mount, route) {
  const isEdit = route.name === 'edit';
  const [topics, tags] = await Promise.all([getTopics(), getTags()]);
  const item = isEdit && route.param ? await db.getItem(route.param) : null;

  mount.append(
    itemForm(
      { item, topics, tagNames: tags.map((tag) => tag.name) },
      {
        onCancel: () => navigate(item ? `/item/${item.id}` : '/library'),
        onSubmit: async ({ payload, tags: tagNames, file, removeExisting }) => {
          let saved = item ? await db.updateItem(item.id, payload) : await db.createItem(payload);

          if (removeExisting && item?.file_path) {
            await db.removeFile(item.file_path);
            saved = await db.updateItem(saved.id, { file_path: null });
          }
          if (file) {
            if (item?.file_path && !removeExisting) {
              await db.removeFile(item.file_path).catch(() => {});
            }
            const path = await db.uploadFile(saved.id, file);
            saved = await db.updateItem(saved.id, { file_path: path });
          }
          await db.setItemTags(saved.id, tagNames);

          invalidate('tags', 'itemOptions');
          toast(t('form.saved'));
          navigate(`/item/${saved.id}`);
        },
      }
    )
  );
}

registerScreen('new', renderForm);
registerScreen('edit', renderForm);

// --------------------------------------------------------------------------
// Dashboard - the systematic overview
// --------------------------------------------------------------------------

/** Slug from the English name, kept unique against the topics already loaded. */
function topicSlug(name, topics) {
  const base = db.normalize(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'topic';
  const taken = new Set(topics.map((topic) => topic.slug));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** Last `count` months as chart-ready buckets, zero-filled so gaps stay visible. */
function monthBuckets(facets, count = 12) {
  const now = new Date();
  const keys = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  const tally = new Map(keys.map((key) => [key, 0]));
  for (const facet of facets) {
    if (!facet.learned_on) continue;
    const key = String(facet.learned_on).slice(0, 7);
    if (tally.has(key)) tally.set(key, tally.get(key) + 1);
  }
  return keys.map((key) => ({ key, label: formatMonth(key), value: tally.get(key) }));
}

function kindBuckets(facets) {
  const tally = new Map(db.KINDS.map((kind) => [kind, 0]));
  for (const facet of facets) tally.set(facet.kind, (tally.get(facet.kind) ?? 0) + 1);
  return [...tally.entries()]
    .map(([kind, value]) => ({ key: kind, label: t(`kind.${kind}`), value }))
    .sort((a, b) => b.value - a.value);
}

registerScreen('dashboard', async (mount) => {
  const [stats, topics, counts, facets, learning, stale] = await Promise.all([
    db.dashboardStats(),
    getTopics(),
    db.topicCounts(),
    db.itemFacets(),
    db.currentlyLearning(8),
    db.leastRecentlyRevisited(8),
  ]);

  const topicsById = topicIndex(topics);
  const countsById = new Map(counts.map((row) => [row.topic_id, row]));

  const openTopic = (topicId) => {
    Object.assign(libraryState, {
      filters: { ...emptyFilters(), topic: topicId, includeSubtopics: true },
      page: 0,
    });
    navigate('/library');
  };

  const afterTopicChange = () => {
    invalidate('topics');
    closeModal();
    renderRoute();
  };

  const openTopicManager = () =>
    openModal(
      topicManager(topics, {
        onCreate: async (topic) => {
          await db.createTopic({ ...topic, slug: topicSlug(topic.name_en, topics) });
          afterTopicChange();
        },
        onUpdate: async (id, patch) => {
          await db.updateTopic(id, patch);
          afterTopicChange();
        },
        onDelete: async (id) => {
          await db.deleteTopic(id);
          afterTopicChange();
        },
      })
    );

  mount.append(
    el('div', { class: 'screen-head' }, el('h1', {}, t('dash.title'))),
    statTiles(stats),

    el('div', { class: 'dash-grid' },
      el('section', { class: 'card' },
        el('div', { class: 'row' },
          el('h2', {}, t('dash.topicTree')),
          el('span', { class: 'spacer' }),
          el('button', { type: 'button', class: 'btn small', onClick: openTopicManager }, t('topic.manage'))),
        el('p', { class: 'small muted' }, t('dash.gapsHint')),
        topicTree(topics, countsById, openTopic)),

      el('div', { class: 'stack' },
        el('section', { class: 'card' },
          el('h2', {}, t('dash.byMonth')),
          columnChart(monthBuckets(facets))),
        el('section', { class: 'card' },
          el('h2', {}, t('dash.byKind')),
          barChart(kindBuckets(facets))))),

    el('div', { class: 'dash-grid' },
      el('section', { class: 'card' },
        el('h2', {}, t('dash.currentlyLearning')),
        compactList(learning, { topicsById })),
      el('section', { class: 'card' },
        el('h2', {}, t('dash.leastRecent')),
        compactList(stale, { topicsById })))
  );
});

// --------------------------------------------------------------------------
// Language switch
// --------------------------------------------------------------------------

function syncLangButtons() {
  $$('.lang-btn').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.lang === getLang())));
}

function wireLanguage() {
  document.documentElement.lang = getLang();
  $$('.lang-btn').forEach((btn) => btn.addEventListener('click', () => setLang(btn.dataset.lang)));
  onLangChange(() => {
    syncLangButtons();
    if (!$('#app').hidden) renderRoute();
    // The config warning is set imperatively, so it needs re-translating by hand.
    if (!$('#auth').hidden && !configured()) showConfigError();
  });
  syncLangButtons();
  applyTranslations();
}

// --------------------------------------------------------------------------
// Keyboard shortcuts
// --------------------------------------------------------------------------

function isTyping(target) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

function wireShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (isModalOpen()) {
        event.preventDefault();
        closeModal();
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event.target) || $('#app').hidden) return;

    if (event.key === '/') {
      event.preventDefault();
      const input = $('#search-input');
      if (input) input.focus();
      else {
        pendingSearchFocus = true;
        navigate('/search');
      }
    } else if (event.key === 'n') {
      event.preventDefault();
      navigate('/new');
    }
  });
}

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------

const configured = () =>
  !SUPABASE_URL.includes('YOUR-PROJECT-REF') && !SUPABASE_ANON_KEY.includes('YOUR-ANON');

function showPane(id) {
  for (const pane of ['boot', 'auth', 'app']) $(`#${pane}`).hidden = pane !== id;
}

function showConfigError() {
  const status = $('#auth-status');
  status.className = 'inline-status error';
  status.textContent = t('auth.configMissing');
}

function wireAuthForm() {
  const form = $('#auth-form');
  const status = $('#auth-status');
  const submit = $('#auth-submit');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('#auth-email').value.trim();
    if (!email) return;
    if (!configured()) {
      showConfigError();
      return;
    }
    submit.disabled = true;
    status.className = 'inline-status';
    status.textContent = t('auth.sending');
    try {
      await db.signInWithEmail(email);
      status.className = 'inline-status ok';
      status.textContent = t('auth.sent');
    } catch (error) {
      status.className = 'inline-status error';
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  $('#sign-out').addEventListener('click', async () => {
    try {
      await db.signOut();
      invalidate();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

let signedIn = false;

function onSession(session) {
  if (session) {
    const wasSignedOut = !signedIn;
    signedIn = true;
    showPane('app');
    if (wasSignedOut) renderRoute();
  } else {
    signedIn = false;
    invalidate();
    showPane('auth');
    if (!configured()) showConfigError();
  }
}

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------

async function boot() {
  wireLanguage();
  wireAuthForm();
  wireShortcuts();

  $$('[data-modal-close]').forEach((node) => node.addEventListener('click', closeModal));
  window.addEventListener('hashchange', () => {
    if (isModalOpen()) closeModal();
    renderRoute();
  });

  if (!configured()) {
    onSession(null);
    return;
  }

  db.onAuthChange(onSession);
  try {
    onSession(await db.getSession());
  } catch (error) {
    showPane('auth');
    const status = $('#auth-status');
    status.className = 'inline-status error';
    status.textContent = error.message;
  }
}

boot();
