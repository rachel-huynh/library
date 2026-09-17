// Rendering only. Nothing here talks to Supabase - controllers in app.js pass
// data in and handlers out. DOM primitives live at the top so app.js can reuse them.

import { t, pick, formatDate, getLang } from './i18n.js';
import { KINDS, STATUSES, LANGS, buildTopicTree } from './db.js';

// ==========================================================================
// DOM primitives
// ==========================================================================

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** el('div', { class: 'x', onClick: fn }, child, 'text') */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') node.innerHTML = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function loadingNode(key = 'common.loading') {
  return el('p', { class: 'loading' }, el('span', { class: 'spinner' }), t(key));
}

export function errorNode(error, onRetry) {
  const message = error?.message ? String(error.message) : t('common.error');
  const box = el('div', { class: 'error-box', role: 'alert' }, message);
  if (onRetry) box.append(' ', el('button', { class: 'btn small', onClick: onRetry }, t('common.retry')));
  return box;
}

export function emptyNode(key = 'common.empty') {
  return el('div', { class: 'empty-state' }, t(key));
}

export function toast(message, kind = 'ok') {
  const node = el('div', { class: `toast ${kind}` }, message);
  $('#toast-root').append(node);
  setTimeout(() => node.remove(), 4000);
}

let modalCloser = null;

export function openModal(content, { onClose } = {}) {
  const root = $('#modal-root');
  const body = $('.modal-body', root);
  clear(body).append(content);
  root.hidden = false;
  $('.modal-panel', root).focus();
  modalCloser = () => {
    root.hidden = true;
    clear(body);
    modalCloser = null;
    onClose?.();
  };
  return modalCloser;
}

export function closeModal() {
  modalCloser?.();
}

export function isModalOpen() {
  return !$('#modal-root').hidden;
}

/** Promise-based confirmation dialog - the app never uses alert()/confirm(). */
export function confirmDialog(messageKey = 'common.confirmDelete') {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(answer);
    };
    openModal(
      el(
        'div',
        { class: 'stack' },
        el('p', {}, t(messageKey)),
        el(
          'div',
          { class: 'row' },
          el('button', { type: 'button', class: 'btn danger', onClick: () => finish(true) }, t('common.delete')),
          el('button', { type: 'button', class: 'btn ghost', onClick: () => finish(false) }, t('common.cancel'))
        )
      ),
      { onClose: () => { if (!settled) { settled = true; resolve(false); } } }
    );
  });
}

/** Disable a button and show a spinner while `work` runs. */
export async function withBusy(button, work, busyKey = 'common.saving') {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = t(busyKey);
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// ==========================================================================
// Labels and formatting
// ==========================================================================

export const kindLabel = (kind) => t(`kind.${kind}`);
export const statusLabel = (status) => t(`status.${status}`);
export const langLabel = (lang) => t(`lang.${lang}`);

export const itemTitle = (item) => pick(item?.title, item?.title_alt);
export const topicName = (topic) => (topic ? pick(topic.name_en, topic.name_vi) : '');

export function ratingStars(rating) {
  if (!rating) return '';
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

/** Per-character diacritic strip that keeps string length, so we can map indexes back. */
function normChars(text) {
  return [...String(text)]
    .map((ch) => {
      const stripped = ch
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D');
      return (stripped || ch).toLowerCase();
    })
    .join('');
}

/** Wrap query matches in <mark>, ignoring accents and case. */
export function highlight(text, query) {
  const source = String(text ?? '');
  const fragment = document.createDocumentFragment();
  const terms = String(query ?? '')
    .split(/[\s,]+/)
    .map((term) => normChars(term.replace(/["']/g, '')))
    .filter((term) => term.length > 1);
  if (!source || !terms.length) {
    fragment.append(source);
    return fragment;
  }

  const haystack = normChars(source);
  const ranges = [];
  for (const term of terms) {
    let from = haystack.indexOf(term);
    while (from !== -1) {
      ranges.push([from, from + term.length]);
      from = haystack.indexOf(term, from + term.length);
    }
  }
  if (!ranges.length) {
    fragment.append(source);
    return fragment;
  }

  ranges.sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    if (start > cursor) fragment.append(source.slice(cursor, start));
    fragment.append(el('mark', {}, source.slice(start, end)));
    cursor = end;
  }
  if (cursor < source.length) fragment.append(source.slice(cursor));
  return fragment;
}

/**
 * Render a ts_headline snippet. Postgres marks hits with << >> rather than HTML,
 * so the text is never injected as markup.
 */
export function snippetNode(snippet) {
  const fragment = document.createDocumentFragment();
  const text = String(snippet ?? '');
  if (!text) return fragment;

  const parts = text.split(/<<|>>/);
  parts.forEach((part, index) => {
    if (!part) return;
    // Odd indexes sit between a << and its >>, so they are the matched terms.
    fragment.append(index % 2 ? el('mark', {}, part) : document.createTextNode(part));
  });
  return fragment;
}

/** Keyword chips derived from the document body. */
export function keywordChips(keywords, onSelect) {
  if (!keywords?.length) return null;
  return el('div', { class: 'row tag-chips keyword-chips' },
    keywords.map((word) =>
      onSelect
        ? el('button', { type: 'button', class: 'badge keyword', onClick: () => onSelect(word) }, word)
        : el('span', { class: 'badge keyword' }, word)));
}

export function excerpt(text, max = 180) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Flatten the topic tree into <option>-friendly rows with indentation. */
export function flattenTopics(topics) {
  const out = [];
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      out.push({ ...node, depth, label: `${'— '.repeat(depth)}${topicName(node)}` });
      walk(node.children ?? [], depth + 1);
    }
  };
  walk(buildTopicTree(topics), 0);
  return out;
}

function optionList(select, options, selected) {
  for (const option of options) {
    select.append(el('option', { value: option.value, selected: String(option.value) === String(selected ?? '') }, option.label));
  }
  return select;
}

export function labelledField(labelKey, control, hint) {
  return el('label', { class: 'field' }, el('span', {}, t(labelKey)), control, hint ? el('span', { class: 'small muted' }, hint) : null);
}

// ==========================================================================
// Item lists (shared by Library and Search)
// ==========================================================================

function itemBadges(item) {
  return el(
    'span',
    { class: 'row badges' },
    el('span', { class: 'badge accent' }, kindLabel(item.kind)),
    el('span', { class: `badge status-${item.status}` }, statusLabel(item.status)),
    item.year ? el('span', { class: 'badge' }, item.year) : null,
    item.rating ? el('span', { class: 'badge stars', title: `${item.rating}/5` }, ratingStars(item.rating)) : null
  );
}

function itemTagChips(item) {
  if (!item.tags?.length) return null;
  return el('span', { class: 'row tag-chips' }, item.tags.map((tag) => el('span', { class: 'badge' }, `#${tag.name}`)));
}

export function itemsTable(rows, { query = '', topicsById = new Map() } = {}) {
  const head = el(
    'thead',
    {},
    el(
      'tr',
      {},
      el('th', {}, t('item.title')),
      el('th', {}, t('item.kind')),
      el('th', {}, t('item.topic')),
      el('th', {}, t('item.status')),
      el('th', {}, t('item.year')),
      el('th', {}, t('item.rating')),
      el('th', {}, t('item.learnedOn'))
    )
  );
  const body = el(
    'tbody',
    {},
    rows.map((item) =>
      el(
        'tr',
        {},
        el(
          'td',
          {},
          el('a', { class: 'item-link', href: `#/item/${item.id}` }, highlight(itemTitle(item), query)),
          item.title_alt && getLang() === 'en'
            ? el('div', { class: 'small muted' }, highlight(item.title_alt, query))
            : null,
          itemTagChips(item)
        ),
        el('td', {}, kindLabel(item.kind)),
        el('td', {}, topicName(item.topic ?? topicsById.get(item.topic_id)) || '—'),
        el('td', {}, el('span', { class: `badge status-${item.status}` }, statusLabel(item.status))),
        el('td', {}, item.year ?? '—'),
        el('td', { class: 'stars' }, ratingStars(item.rating) || '—'),
        el('td', {}, formatDate(item.learned_on) || '—')
      )
    )
  );
  return el('div', { class: 'table-wrap' }, el('table', { class: 'items-table' }, head, body));
}

export function itemsCards(rows, { query = '', topicsById = new Map() } = {}) {
  return el(
    'div',
    { class: 'card-grid' },
    rows.map((item) =>
      el(
        'a',
        { class: 'card item-card', href: `#/item/${item.id}` },
        el('h3', {}, highlight(itemTitle(item), query)),
        item.authors ? el('p', { class: 'small muted' }, highlight(item.authors, query)) : null,
        itemBadges(item),
        topicName(item.topic ?? topicsById.get(item.topic_id))
          ? el('p', { class: 'small muted' }, topicName(item.topic ?? topicsById.get(item.topic_id)))
          : null,
        // A search hit carries its own snippet from the document body; otherwise
        // fall back to the summary.
        item.snippet
          ? el('p', { class: 'small snippet' }, snippetNode(item.snippet))
          : item.summary
            ? el('p', { class: 'small' }, highlight(excerpt(item.summary), query))
            : null,
        item.file_path && item.snippet ? el('span', { class: 'badge tiny' }, t('search.inDocument')) : null,
        itemTagChips(item)
      )
    )
  );
}

export function itemList(rows, options = {}) {
  if (!rows.length) return emptyNode(options.emptyKey ?? 'library.empty');
  return options.view === 'cards' ? itemsCards(rows, options) : itemsTable(rows, options);
}

// ==========================================================================
// Library screen
// ==========================================================================

function chipGroup(values, selected, labelFn, onToggle) {
  return el(
    'div',
    { class: 'chip-group' },
    values.map((value) =>
      el(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(selected.includes(value)),
          onClick: () => onToggle(value),
        },
        labelFn(value)
      )
    )
  );
}

export function libraryFilters({ topics, tags, state, onChange, onClear }) {
  const patch = (changes) => onChange({ ...state, ...changes, page: 0 });
  const patchFilters = (changes) => patch({ filters: { ...state.filters, ...changes } });
  const toggle = (key, value) => {
    const list = state.filters[key] ?? [];
    patchFilters({ [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] });
  };

  const topicSelect = optionList(
    el('select', { onChange: (e) => patchFilters({ topic: e.target.value }) }),
    [{ value: '', label: t('common.all') }, ...flattenTopics(topics).map((tp) => ({ value: tp.id, label: tp.label }))],
    state.filters.topic
  );

  const tagSelect = optionList(
    el('select', { onChange: (e) => patchFilters({ tagIds: e.target.value ? [e.target.value] : [] }) }),
    [{ value: '', label: t('common.all') }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))],
    state.filters.tagIds?.[0]
  );

  const ratingSelect = optionList(
    el('select', { onChange: (e) => patchFilters({ minRating: e.target.value ? Number(e.target.value) : null }) }),
    [{ value: '', label: t('common.all') }, ...[1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${ratingStars(n)}` }))],
    state.filters.minRating
  );

  const yearInput = el('input', {
    type: 'number',
    min: '1000',
    max: '2999',
    value: state.filters.year ?? '',
    onChange: (e) => patchFilters({ year: e.target.value ? Number(e.target.value) : null }),
  });

  const sortSelect = optionList(
    el('select', {
      onChange: (e) => {
        const [column, direction] = e.target.value.split(':');
        patch({ sort: { column, ascending: direction === 'asc' } });
      },
    }),
    [
      { value: 'updated_at:desc', label: t('item.updatedAt') },
      { value: 'created_at:desc', label: t('item.createdAt') },
      { value: 'learned_on:desc', label: t('item.learnedOn') },
      { value: 'title:asc', label: t('item.title') },
      { value: 'year:desc', label: t('item.year') },
      { value: 'rating:desc', label: t('item.rating') },
    ],
    `${state.sort.column}:${state.sort.ascending ? 'asc' : 'desc'}`
  );

  const subtopicToggle = el('label', { class: 'check' },
    el('input', {
      type: 'checkbox',
      checked: state.filters.includeSubtopics !== false,
      onChange: (e) => patchFilters({ includeSubtopics: e.target.checked }),
    }),
    el('span', {}, t('library.includeSubtopics'))
  );

  const chipColumn = (labelKey, values, selected, labelFn, key) =>
    el('div', { class: 'chip-column' },
      el('span', { class: 'field-label' }, t(labelKey)),
      chipGroup(values, selected ?? [], labelFn, (value) => toggle(key, value)));

  return el(
    'section',
    { class: 'card filters' },
    el('div', { class: 'filters-grid' },
      labelledField('item.topic', topicSelect),
      labelledField('item.tags', tagSelect),
      labelledField('item.year', yearInput),
      labelledField('library.minRating', ratingSelect),
      labelledField('library.sort', sortSelect)
    ),
    subtopicToggle,
    el('div', { class: 'filters-chips' },
      chipColumn('item.kind', KINDS, state.filters.kinds, kindLabel, 'kinds'),
      chipColumn('item.status', STATUSES, state.filters.statuses, statusLabel, 'statuses'),
      chipColumn('item.lang', LANGS, state.filters.langs, langLabel, 'langs')
    ),
    el('div', { class: 'filters-actions' },
      el('button', { type: 'button', class: 'btn small', onClick: onClear }, t('common.clear')),
      el('div', { class: 'view-toggle' },
        el('button', { type: 'button', class: 'btn small', 'aria-pressed': String(state.view !== 'cards'), onClick: () => patch({ view: 'table' }) }, t('library.view.table')),
        el('button', { type: 'button', class: 'btn small', 'aria-pressed': String(state.view === 'cards'), onClick: () => patch({ view: 'cards' }) }, t('library.view.cards'))
      )
    )
  );
}

export function pagination({ page, pageSize, count, onPage }) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  return el(
    'div',
    { class: 'pagination row' },
    el('span', { class: 'muted small' }, `${count} ${t('common.results')}`),
    el('span', { class: 'spacer' }),
    el('button', { type: 'button', class: 'btn small', disabled: page <= 0, onClick: () => onPage(page - 1) }, t('common.previous')),
    el('span', { class: 'muted small' }, `${t('common.page')} ${page + 1} ${t('common.of')} ${pages}`),
    el('button', { type: 'button', class: 'btn small', disabled: page + 1 >= pages, onClick: () => onPage(page + 1) }, t('common.next'))
  );
}

// ==========================================================================
// Item detail
// ==========================================================================

function metaRow(labelKey, value) {
  if (!value && value !== 0) return null;
  return el('div', { class: 'meta-row' }, el('dt', {}, t(labelKey)), el('dd', {}, value));
}

function noteNode(note, { onUpdate, onDelete }) {
  const wrap = el('li', { class: 'note' });

  const showRead = () => {
    clear(wrap).append(
      el('div', { class: 'row note-head' },
        note.locator ? el('span', { class: 'badge' }, note.locator) : null,
        el('span', { class: 'small muted' }, formatDate(note.created_at)),
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'btn small ghost', onClick: showEdit }, t('common.edit')),
        el('button', {
          type: 'button', class: 'btn small ghost danger',
          onClick: async (e) => {
            const button = e.currentTarget;
            if (await confirmDialog()) await withBusy(button, () => onDelete(note));
          },
        }, t('common.delete'))
      ),
      el('p', { class: 'note-body' }, note.body)
    );
  };

  const showEdit = () => {
    const locator = el('input', { type: 'text', value: note.locator ?? '', 'data-i18n-placeholder': 'item.noteLocator', placeholder: t('item.noteLocator') });
    const body = el('textarea', {}, note.body);
    const status = el('p', { class: 'inline-status' });
    clear(wrap).append(
      locator,
      body,
      el('div', { class: 'row' },
        el('button', {
          type: 'button', class: 'btn small primary',
          onClick: async (e) => {
            status.className = 'inline-status';
            status.textContent = '';
            try {
              await withBusy(e.currentTarget, () => onUpdate(note, { locator: locator.value.trim() || null, body: body.value.trim() }));
            } catch (error) {
              status.className = 'inline-status error';
              status.textContent = error.message;
            }
          },
        }, t('common.save')),
        el('button', { type: 'button', class: 'btn small ghost', onClick: showRead }, t('common.cancel'))
      ),
      status
    );
  };

  showRead();
  return wrap;
}

export function itemDetail({ item, notes, links, breadcrumb, fileUrl }, handlers) {
  const notesList = el('ul', { class: 'note-list' }, notes.map((note) =>
    noteNode(note, { onUpdate: handlers.onUpdateNote, onDelete: handlers.onDeleteNote })));

  const newLocator = el('input', { type: 'text', placeholder: t('item.noteLocator') });
  const newBody = el('textarea', { placeholder: t('item.noteBody') });
  const noteStatus = el('p', { class: 'inline-status' });

  const addNote = async (event) => {
    const body = newBody.value.trim();
    if (!body) return;
    noteStatus.className = 'inline-status';
    noteStatus.textContent = '';
    try {
      await withBusy(event.currentTarget, () => handlers.onAddNote({ locator: newLocator.value.trim() || null, body }));
      newLocator.value = '';
      newBody.value = '';
    } catch (error) {
      noteStatus.className = 'inline-status error';
      noteStatus.textContent = error.message;
    }
  };

  const relatedSelect = el('select', {}, el('option', { value: '' }, t('common.none')),
    handlers.itemOptions.filter((o) => o.id !== item.id).map((o) => el('option', { value: o.id }, o.title)));

  return el(
    'article',
    { class: 'item-detail stack' },
    el('div', { class: 'screen-head' },
      el('div', {},
        breadcrumb.length ? el('p', { class: 'small muted breadcrumb' }, breadcrumb.join(' › ')) : null,
        el('h1', {}, itemTitle(item)),
        item.title_alt ? el('p', { class: 'muted' }, pick(item.title_alt, item.title)) : null,
        itemBadges(item)
      ),
      el('div', { class: 'row' },
        el('a', { class: 'btn', href: `#/edit/${item.id}` }, t('common.edit')),
        el('button', {
          type: 'button', class: 'btn danger',
          onClick: async (e) => {
            const button = e.currentTarget;
            if (await confirmDialog()) await withBusy(button, handlers.onDeleteItem);
          },
        }, t('common.delete'))
      )
    ),

    el('section', { class: 'card' },
      el('dl', { class: 'meta-grid' },
        metaRow('item.authors', item.authors),
        metaRow('item.source', item.source),
        metaRow('item.lang', langLabel(item.lang)),
        metaRow('item.url', item.url ? el('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer' }, t('item.openLink')) : null),
        metaRow('item.file', fileUrl
          ? el('a', { href: fileUrl, target: '_blank', rel: 'noopener noreferrer', download: '' }, t('item.download'))
          : el('span', { class: 'muted' }, t('item.noFile'))),
        metaRow('item.learnedOn', formatDate(item.learned_on)),
        metaRow('item.createdAt', formatDate(item.created_at)),
        metaRow('item.updatedAt', formatDate(item.updated_at)),
        metaRow('item.tags', item.tags?.length ? el('span', { class: 'row tag-chips' }, item.tags.map((tag) => el('span', { class: 'badge' }, `#${tag.name}`))) : null)
      )
    ),

    item.keywords?.length
      ? el('section', { class: 'card' },
          el('h2', {}, t('item.keywords')),
          keywordChips(item.keywords, handlers.onKeyword),
          item.content_method
            ? el('p', { class: 'small muted' },
                t('item.extractedFrom', { pages: item.content_pages ?? '?', method: t(`item.method.${item.content_method}`) }))
            : null)
      : null,

    item.summary ? el('section', { class: 'card' }, el('h2', {}, t('item.summary')), el('p', { class: 'prose' }, item.summary)) : null,
    item.takeaways ? el('section', { class: 'card' }, el('h2', {}, t('item.takeaways')), el('p', { class: 'prose' }, item.takeaways)) : null,

    el('section', { class: 'card' },
      el('h2', {}, t('item.notes')),
      notes.length ? notesList : el('p', { class: 'muted small' }, t('common.empty')),
      el('div', { class: 'note-form' },
        newLocator,
        newBody,
        el('button', { type: 'button', class: 'btn primary', onClick: addNote }, t('item.addNote')),
        noteStatus
      )
    ),

    el('section', { class: 'card' },
      el('h2', {}, t('item.related')),
      links.length
        ? el('ul', { class: 'link-list' }, links.map((link) =>
            el('li', { class: 'row' },
              el('a', { href: `#/item/${link.to_item}` }, link.item ? itemTitle(link.item) : link.to_item),
              el('span', { class: 'badge' }, link.relation),
              el('span', { class: 'spacer' }),
              el('button', {
                type: 'button', class: 'btn small ghost danger',
                onClick: (e) => withBusy(e.currentTarget, () => handlers.onRemoveLink(link)),
              }, t('common.delete'))
            )))
        : el('p', { class: 'muted small' }, t('common.empty')),
      el('div', { class: 'row' },
        relatedSelect,
        el('button', {
          type: 'button', class: 'btn small',
          onClick: (e) => relatedSelect.value && withBusy(e.currentTarget, () => handlers.onAddLink(relatedSelect.value)),
        }, t('common.save'))
      )
    )
  );
}

// ==========================================================================
// Add / edit form
// ==========================================================================

export function itemForm({ item, topics, tagNames }, handlers) {
  const isEdit = Boolean(item?.id);
  const value = (key, fallback = '') => item?.[key] ?? fallback;

  const titleInput = el('input', { type: 'text', required: true, value: value('title') });
  const titleAltInput = el('input', { type: 'text', value: value('title_alt') });
  const langSelect = optionList(el('select', {}), LANGS.map((l) => ({ value: l, label: langLabel(l) })), value('lang', 'en'));
  const kindSelect = optionList(el('select', {}), KINDS.map((k) => ({ value: k, label: kindLabel(k) })), value('kind', 'other'));
  const statusSelect = optionList(el('select', {}), STATUSES.map((s) => ({ value: s, label: statusLabel(s) })), value('status', 'inbox'));
  const topicSelect = optionList(
    el('select', {}),
    [{ value: '', label: t('common.none') }, ...flattenTopics(topics).map((tp) => ({ value: tp.id, label: tp.label }))],
    value('topic_id')
  );
  const authorsInput = el('input', { type: 'text', value: value('authors') });
  const sourceInput = el('input', { type: 'text', value: value('source') });
  const urlInput = el('input', { type: 'url', value: value('url') });
  const yearInput = el('input', { type: 'number', min: '1000', max: '2999', value: value('year') });
  const ratingSelect = optionList(
    el('select', {}),
    [{ value: '', label: t('common.none') }, ...[1, 2, 3, 4, 5].map((n) => ({ value: n, label: ratingStars(n) }))],
    value('rating')
  );
  const learnedOnInput = el('input', { type: 'date', value: value('learned_on') });
  const summaryInput = el('textarea', {}, value('summary'));
  const takeawaysInput = el('textarea', {}, value('takeaways'));

  const tagListId = 'tag-suggestions';
  const tagsInput = el('input', {
    type: 'text',
    list: tagListId,
    value: (item?.tags ?? []).map((tag) => tag.name).join(', '),
  });
  const tagsDatalist = el('datalist', { id: tagListId }, tagNames.map((name) => el('option', { value: name })));

  // ---- attachment -------------------------------------------------------
  let pickedFile = null;
  let removeExisting = false;
  const fileInput = el('input', { type: 'file', class: 'visually-hidden' });
  const fileState = el('p', { class: 'small muted' });

  const renderFileState = () => {
    clear(fileState);
    if (pickedFile) fileState.append(pickedFile.name);
    else if (item?.file_path && !removeExisting) fileState.append(item.file_path.split('/').pop());
    else fileState.append(t('item.noFile'));
  };

  const dropzone = el('div', {
    class: 'dropzone',
    tabindex: '0',
    role: 'button',
    onClick: () => fileInput.click(),
    onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
    onDragover: (e) => { e.preventDefault(); dropzone.classList.add('over'); },
    onDragleave: () => dropzone.classList.remove('over'),
    onDrop: (e) => {
      e.preventDefault();
      dropzone.classList.remove('over');
      if (e.dataTransfer.files?.[0]) { pickedFile = e.dataTransfer.files[0]; removeExisting = false; renderFileState(); }
    },
  }, el('span', {}, t('form.dropFile')));

  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) { pickedFile = fileInput.files[0]; removeExisting = false; renderFileState(); }
  });

  const removeFileBtn = el('button', {
    type: 'button', class: 'btn small ghost',
    onClick: () => { pickedFile = null; removeExisting = true; fileInput.value = ''; renderFileState(); },
  }, t('form.removeFile'));

  renderFileState();

  // ---- submit -----------------------------------------------------------
  const status = el('p', { class: 'inline-status', role: 'status' });
  const submitBtn = el('button', { type: 'submit', class: 'btn primary' }, t('common.save'));

  const form = el('form', {
    class: 'item-form stack',
    novalidate: true,
    onSubmit: async (event) => {
      event.preventDefault();
      const title = titleInput.value.trim();
      status.className = 'inline-status';
      status.textContent = '';
      if (!title) {
        status.className = 'inline-status error';
        status.textContent = t('item.title');
        titleInput.focus();
        return;
      }
      const payload = {
        title,
        title_alt: titleAltInput.value.trim() || null,
        lang: langSelect.value,
        kind: kindSelect.value,
        status: statusSelect.value,
        topic_id: topicSelect.value || null,
        authors: authorsInput.value.trim() || null,
        source: sourceInput.value.trim() || null,
        url: urlInput.value.trim() || null,
        year: yearInput.value ? Number(yearInput.value) : null,
        rating: ratingSelect.value ? Number(ratingSelect.value) : null,
        learned_on: learnedOnInput.value || null,
        summary: summaryInput.value.trim() || null,
        takeaways: takeawaysInput.value.trim() || null,
      };
      const tags = tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean);
      try {
        await withBusy(submitBtn, () => handlers.onSubmit({ payload, tags, file: pickedFile, removeExisting }), 'form.uploading');
      } catch (error) {
        status.className = 'inline-status error';
        status.textContent = error.message;
      }
    },
  });

  form.append(
    el('h1', {}, t(isEdit ? 'form.editItem' : 'form.newItem')),
    labelledField('item.title', titleInput),
    labelledField('item.titleAlt', titleAltInput),
    el('div', { class: 'form-row' }, labelledField('item.kind', kindSelect), labelledField('item.status', statusSelect), labelledField('item.lang', langSelect)),
    labelledField('item.topic', topicSelect),
    labelledField('item.tags', tagsInput, t('form.tagsHint')),
    tagsDatalist,
    el('div', { class: 'form-row' }, labelledField('item.authors', authorsInput), labelledField('item.source', sourceInput)),
    el('div', { class: 'form-row' }, labelledField('item.year', yearInput), labelledField('item.rating', ratingSelect), labelledField('item.learnedOn', learnedOnInput)),
    labelledField('item.url', urlInput),
    el('div', { class: 'field' }, el('span', {}, t('item.file')), dropzone, fileInput, el('div', { class: 'row' }, fileState, el('span', { class: 'spacer' }), removeFileBtn)),
    labelledField('item.summary', summaryInput),
    labelledField('item.takeaways', takeawaysInput),
    el('div', { class: 'row' },
      submitBtn,
      el('button', { type: 'button', class: 'btn ghost', onClick: handlers.onCancel }, t('common.cancel'))
    ),
    status
  );

  return form;
}

// ==========================================================================
// Dashboard
// ==========================================================================

export function statTiles(stats) {
  const tile = (labelKey, value, href) =>
    el(href ? 'a' : 'div', { class: 'card stat-tile', href },
      el('span', { class: 'stat-value' }, String(value)),
      el('span', { class: 'stat-label' }, t(labelKey)));

  return el('div', { class: 'stat-row' },
    tile('dash.totalItems', stats.total, '#/library'),
    tile('dash.learning', stats.learning),
    tile('dash.done', stats.done),
    tile('dash.notes', stats.notes));
}

/** Nested topic tree with subtree counts; branches holding nothing are dimmed. */
export function topicTree(topics, countsById, onSelect) {
  const render = (nodes) =>
    el('ul', { class: 'topic-tree' }, nodes.map((node) => {
      const counts = countsById.get(node.id) ?? { total_count: 0, direct_count: 0 };
      const total = Number(counts.total_count ?? 0);
      return el('li', { class: total ? 'topic-node' : 'topic-node empty' },
        el('button', {
          type: 'button',
          class: 'topic-label',
          style: node.color ? `--topic-color:${node.color}` : null,
          onClick: () => onSelect(node.id),
        },
          el('span', { class: 'topic-dot', 'aria-hidden': 'true' }),
          el('span', {}, topicName(node)),
          el('span', { class: 'badge' }, String(total))),
        node.children?.length ? render(node.children) : null);
    }));

  const roots = buildTopicTree(topics);
  if (!roots.length) return el('p', { class: 'muted small' }, t('dash.noTopics'));
  return render(roots);
}

/**
 * Minimal topic editor shown in a modal - the tree has to be editable somewhere,
 * and the dashboard is where it is read.
 */
export function topicManager(topics, handlers) {
  const status = el('p', { class: 'inline-status', role: 'status' });
  const fail = (error) => {
    status.className = 'inline-status error';
    status.textContent = error.message;
  };

  const flat = flattenTopics(topics);

  const nameEn = el('input', { type: 'text', required: true });
  const nameVi = el('input', { type: 'text' });
  const parent = optionList(
    el('select', {}),
    [{ value: '', label: t('common.none') }, ...flat.filter((tp) => tp.depth < 2).map((tp) => ({ value: tp.id, label: tp.label }))],
    ''
  );
  const color = el('input', { type: 'color', value: '#3f6fd4' });
  const sort = el('input', { type: 'number', value: '0' });
  const addBtn = el('button', { type: 'submit', class: 'btn primary' }, t('topic.add'));

  const existing = el('ul', { class: 'topic-admin-list' }, flat.map((topic) =>
    el('li', { class: 'row' },
      el('span', { class: 'spacer' }, topic.label),
      el('button', {
        type: 'button', class: 'btn small ghost',
        onClick: async (event) => {
          const input = el('input', { type: 'text', value: topic.name_en });
          const viInput = el('input', { type: 'text', value: topic.name_vi ?? '' });
          const row = event.currentTarget.parentElement;
          clear(row).append(input, viInput,
            el('button', {
              type: 'button', class: 'btn small primary',
              onClick: (e) => withBusy(e.currentTarget, () =>
                handlers.onUpdate(topic.id, { name_en: input.value.trim(), name_vi: viInput.value.trim() || null })).catch(fail),
            }, t('common.save')));
        },
      }, t('common.edit')),
      el('button', {
        type: 'button', class: 'btn small ghost danger',
        onClick: async (event) => {
          const button = event.currentTarget;
          if (await confirmDialog('topic.deleteWarning')) {
            await withBusy(button, () => handlers.onDelete(topic.id)).catch(fail);
          }
        },
      }, t('common.delete')))));

  const form = el('form', {
    class: 'stack',
    onSubmit: async (event) => {
      event.preventDefault();
      const name = nameEn.value.trim();
      if (!name) return nameEn.focus();
      status.className = 'inline-status';
      status.textContent = '';
      try {
        await withBusy(addBtn, () => handlers.onCreate({
          name_en: name,
          name_vi: nameVi.value.trim() || null,
          parent_id: parent.value || null,
          color: color.value,
          sort: Number(sort.value) || 0,
        }));
      } catch (error) {
        fail(error);
      }
    },
  },
    labelledField('topic.nameEn', nameEn),
    labelledField('topic.nameVi', nameVi),
    labelledField('topic.parent', parent),
    el('div', { class: 'form-row' }, labelledField('topic.color', color), labelledField('topic.sort', sort)),
    addBtn);

  return el('div', { class: 'stack' },
    el('h2', {}, t('topic.manage')),
    flat.length ? existing : el('p', { class: 'muted small' }, t('dash.noTopics')),
    form,
    status);
}

/** Vertical bars - used for the month histogram. */
export function columnChart(data, { emptyKey = 'common.empty' } = {}) {
  if (!data.some((d) => d.value > 0)) return el('p', { class: 'muted small' }, t(emptyKey));
  const max = Math.max(...data.map((d) => d.value), 1);
  return el('div', {
    class: 'column-chart',
    role: 'img',
    'aria-label': data.map((d) => `${d.label}: ${d.value}`).join(', '),
  }, data.map((d) =>
    el('div', { class: 'column', title: `${d.label}: ${d.value}` },
      el('span', { class: 'column-value small muted' }, d.value || ''),
      el('span', { class: 'column-bar', style: `height:${Math.round((d.value / max) * 100)}%` }),
      el('span', { class: 'column-label small muted' }, d.label))));
}

/** Horizontal bars - used for the breakdown by kind. */
export function barChart(data, { emptyKey = 'common.empty' } = {}) {
  if (!data.some((d) => d.value > 0)) return el('p', { class: 'muted small' }, t(emptyKey));
  const max = Math.max(...data.map((d) => d.value), 1);
  return el('div', {
    class: 'bar-chart',
    role: 'img',
    'aria-label': data.map((d) => `${d.label}: ${d.value}`).join(', '),
  }, data.map((d) =>
    el('div', { class: 'bar-row', title: `${d.label}: ${d.value}` },
      el('span', { class: 'bar-label small' }, d.label),
      el('span', { class: 'bar-track' }, el('span', { class: 'bar-fill', style: `width:${(d.value / max) * 100}%` })),
      el('span', { class: 'bar-value small muted' }, String(d.value)))));
}

/** Compact item list used by the two dashboard panels. */
export function compactList(rows, { topicsById = new Map(), emptyKey = 'common.empty' } = {}) {
  if (!rows.length) return el('p', { class: 'muted small' }, t(emptyKey));
  return el('ul', { class: 'compact-list' }, rows.map((item) =>
    el('li', {},
      el('a', { href: `#/item/${item.id}` }, itemTitle(item)),
      el('span', { class: 'row small muted' },
        el('span', {}, kindLabel(item.kind)),
        topicName(topicsById.get(item.topic_id)) ? el('span', {}, '· ' + topicName(topicsById.get(item.topic_id))) : null,
        el('span', { class: 'spacer' }),
        el('span', {}, formatDate(item.updated_at))))));
}

// ==========================================================================
// Search screen
// ==========================================================================

export function searchScreen({ initialQuery, onQuery }) {
  const input = el('input', {
    id: 'search-input',
    type: 'search',
    value: initialQuery ?? '',
    placeholder: t('search.placeholder'),
    autocomplete: 'off',
  });
  const results = el('div', { class: 'search-results' });

  let debounce = 0;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => onQuery(input.value), 250);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(debounce);
      onQuery(input.value);
    }
  });

  const node = el(
    'div',
    { class: 'stack' },
    el('h1', {}, t('search.title')),
    el('div', { class: 'search-box' }, input),
    el('p', { class: 'small muted' }, t('search.hint')),
    results
  );

  return { node, input, results };
}
