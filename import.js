// One-off bulk import of the TRAINING MATERIALS folder.
// Runs in the signed-in browser: files go straight from disk to Supabase Storage.
// Idempotent - an item already present (same title + topic) is skipped, so re-running is safe.

import * as db from './db.js';

const $ = (sel) => document.querySelector(sel);
const logEl = $('#log');
const picked = new Map(); // relative path (below the root folder) -> File

let manifest = null;

function log(line, kind = '') {
  const stamp = new Date().toLocaleTimeString();
  logEl.textContent += `${stamp}  ${kind ? `[${kind}] ` : ''}${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setProgress(done, total, label) {
  $('#progress').hidden = false;
  $('#progress-fill').style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  $('#progress-text').textContent = `${done} / ${total}  ${label ?? ''}`;
}

// --------------------------------------------------------------------------
// Load manifest + session
// --------------------------------------------------------------------------

async function init() {
  const summary = $('#summary');
  try {
    manifest = await (await fetch('./import-manifest.json', { cache: 'no-store' })).json();
  } catch (error) {
    summary.innerHTML = `<div class="error-box">Could not load import-manifest.json: ${error.message}</div>`;
    return;
  }

  const session = await db.getSession().catch(() => null);
  const uploadable = manifest.items.filter((i) => i.uploadable);
  const catalogueOnly = manifest.items.filter((i) => !i.uploadable);
  const mb = uploadable.reduce((sum, i) => sum + i.size_mb, 0).toFixed(1);

  summary.innerHTML = `
    <h2>What will be created</h2>
    <ul class="import-summary">
      <li><strong>${manifest.topics.length}</strong> topics (domains and subtopics)</li>
      <li><strong>${manifest.items.length}</strong> items &mdash; ${uploadable.length} with a file attached (${mb} MB), ${catalogueOnly.length} catalogued without one</li>
      <li><strong>${manifest.skipped.length}</strong> files deliberately left out (duplicates, receipts, the Anaconda installer)</li>
    </ul>
    <p class="${session ? 'small muted' : 'error-box'}">${
      session
        ? `Signed in as ${session.user.email}.`
        : 'Not signed in. Open <a href="courses.html">the app</a>, sign in, then come back to this page.'
    }</p>`;

  if (session) $('#run').disabled = false;
}

// --------------------------------------------------------------------------
// Folder picking
// --------------------------------------------------------------------------

$('#folder').addEventListener('change', (event) => {
  picked.clear();
  const files = [...event.target.files];
  for (const file of files) {
    // webkitRelativePath starts with the chosen folder's own name - drop it.
    const rel = file.webkitRelativePath.split('/').slice(1).join('/');
    if (rel) picked.set(rel, file);
  }

  const wanted = manifest?.items ?? [];
  const found = wanted.filter((i) => picked.has(i.path)).length;
  const status = $('#pick-status');
  status.className = found === wanted.length ? 'inline-status ok' : 'inline-status error';
  status.textContent =
    `${files.length} files in folder - matched ${found} of ${wanted.length} catalogue entries.` +
    (found === wanted.length ? '' : ' Check you picked the TRAINING MATERIALS folder itself.');
});

// --------------------------------------------------------------------------
// Import
// --------------------------------------------------------------------------

/** Read a Windows .url shortcut and pull out its target. */
async function readUrlFile(file) {
  const text = await file.text();
  return text.match(/^URL=(.+)$/mi)?.[1]?.trim() ?? null;
}

async function ensureTopics(dryRun) {
  const existing = await db.listTopics();
  const bySlug = new Map(existing.map((t) => [t.slug, t]));
  let created = 0;

  // Parents first, so parent_id can be resolved in one pass.
  const ordered = [...manifest.topics].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
  for (const topic of ordered) {
    if (bySlug.has(topic.slug)) continue;
    const payload = {
      slug: topic.slug,
      name_en: topic.name_en,
      name_vi: topic.name_vi,
      color: topic.color,
      sort: topic.sort,
      parent_id: topic.parent ? bySlug.get(topic.parent)?.id ?? null : null,
    };
    if (dryRun) {
      log(`would create topic "${topic.name_en}"`, 'dry');
      bySlug.set(topic.slug, { id: `dry-${topic.slug}`, ...payload });
    } else {
      const row = await db.createTopic(payload);
      bySlug.set(topic.slug, row);
      created += 1;
      log(`topic "${topic.name_en}"`, 'new');
    }
  }
  log(`topics ready (${created} created, ${bySlug.size - created} already there)`);
  return bySlug;
}

async function runImport() {
  const dryRun = $('#dry-run').checked;
  const runBtn = $('#run');
  runBtn.disabled = true;
  logEl.textContent = '';
  log(dryRun ? 'DRY RUN - nothing will be written.' : 'Importing for real.');

  try {
    const topicsBySlug = await ensureTopics(dryRun);

    // Everything already in the library, so a re-run does not duplicate.
    const { rows: existingItems } = await db.listItems({ pageSize: 1000 });
    const existingKeys = new Set(existingItems.map((i) => `${i.topic_id}|${i.title.toLowerCase()}`));

    const items = manifest.items;
    let done = 0;
    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const entry of items) {
      done += 1;
      setProgress(done, items.length, entry.title);

      const topic = topicsBySlug.get(entry.topic);
      const key = `${topic?.id}|${entry.title.toLowerCase()}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        log(`already in library: ${entry.title}`, 'skip');
        continue;
      }

      const file = picked.get(entry.path);
      if (entry.uploadable && !file) {
        failed += 1;
        log(`file not found in the folder you picked: ${entry.path}`, 'miss');
        continue;
      }

      // The eCornell programme is finished (the credential is in the folder);
      // everything else starts in the inbox.
      const status = entry.topic.startsWith('rm-') || entry.topic === 'revenue-management' ? 'done' : 'inbox';

      const payload = {
        title: entry.title,
        kind: entry.kind,
        lang: entry.lang,
        status,
        topic_id: topic?.id ?? null,
        year: entry.year ?? null,
        source: entry.source,
        // File mtime is the only date we have; it is a reasonable proxy for when
        // the material was studied and makes the dashboard's month chart useful.
        learned_on: file ? new Date(file.lastModified).toISOString().slice(0, 10) : null,
      };

      if (entry.url_file && file) payload.url = await readUrlFile(file);
      if (!entry.uploadable && !entry.url_file) {
        payload.summary = `Stored outside the library: this file is ${entry.size_mb} MB, over the ${manifest.maxUploadMb} MB per-file upload limit. Original path: ${entry.source}`;
      }

      if (dryRun) {
        log(`would add "${entry.title}" -> ${entry.topic}${file && entry.uploadable ? ` (+${entry.size_mb} MB)` : ''}`, 'dry');
        created += 1;
        continue;
      }

      try {
        let row = await db.createItem(payload);
        if (entry.uploadable && file) {
          const path = await db.uploadFile(row.id, file);
          row = await db.updateItem(row.id, { file_path: path });
        }
        if (entry.tags?.length) await db.setItemTags(row.id, entry.tags);
        created += 1;
        log(`added "${entry.title}"`, 'new');
      } catch (error) {
        failed += 1;
        log(`FAILED "${entry.title}": ${error.message}`, 'err');
      }
    }

    log('');
    log(`Done. ${created} ${dryRun ? 'would be added' : 'added'}, ${skipped} already present, ${failed} failed.`);
    if (dryRun) log('Untick "Dry run" and press Start import to write for real.');
  } catch (error) {
    log(`Import stopped: ${error.message}`, 'err');
  } finally {
    runBtn.disabled = false;
  }
}

$('#run').addEventListener('click', runImport);

init();
