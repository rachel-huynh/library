# Knowledge Library

A personal learning archive: slides, lectures, notes, papers, books, videos and courses,
stored once and retrievable two ways — **fast lookup** (search + filter) and a
**systematic overview** (what I studied, under which domain, where the gaps are).

Static web app: plain HTML/CSS/JS, no build step, no npm. Supabase for database, auth and
file storage. Hosted on GitHub Pages.

- UI language: **English by default, Vietnamese toggled at runtime** (`i18n.js`, stored in `localStorage`).
- Search is **diacritic-insensitive**, so `kiem toan` matches `Kiểm toán`.

## Files

| File | Purpose |
| --- | --- |
| `courses.html` | Single page, all screens — the entry point |
| `app.js` | Routing, state, event wiring |
| `db.js` | Every Supabase query lives here |
| `ui.js` | Rendering |
| `i18n.js` | `{ en, vi }` string tables, `t('key')` |
| `style.css` | Styles, dark mode via `prefers-color-scheme` |
| `config.js` | `SUPABASE_URL` + `SUPABASE_ANON_KEY` |
| `serve.ps1` | Local dev server (PowerShell, no install needed) |
| `supabase/schema.sql` | Database schema, RLS, storage policies, RPCs |

## Setup

### 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**. Pick a region near you and save
   the database password somewhere safe (it is not needed by this app).
2. Wait for the project to finish provisioning.

### 2. Run the schema

1. Open **SQL Editor → New query**.
2. Paste the whole contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. It is idempotent — re-run it any time the schema changes.

This creates the tables (`topics`, `items`, `tags`, `item_tags`, `notes`, `item_links`),
indexes, Row Level Security policies, the private `library` storage bucket with its policies,
and two RPCs (`search_items`, `topic_counts`).

### 3. Storage bucket

`schema.sql` already inserts the private bucket `library`. Verify under **Storage** that a
bucket named `library` exists and is **not public**. Files are uploaded to
`library/<your-user-id>/<item-id>/<filename>` and served through short-lived **signed URLs**.

### 4. Auth (magic link, single user)

1. **Authentication → Providers → Email**: enable it, enable *Confirm email*, and leave
   password sign-in off (magic link only).
2. **Authentication → URL Configuration**:
   - *Site URL*: `https://rachel-huynh.github.io/library/courses.html`
   - *Redirect URLs*: add that exact URL, plus `http://localhost:8123/courses.html` for local work.

   The magic link returns to `window.location.origin + pathname`, so the redirect entry has to
   include `courses.html` — the bare folder URL is not enough.
3. Optionally **Authentication → Sign In / Providers → disable sign-ups** after your first
   magic-link login, so only your account can ever exist.

### 5. Wire up `config.js`

Copy the project URL and the **anon/public** key from **Project Settings → API** into
`config.js` (created in step S2). The anon key is safe to publish: RLS is what protects the
data, and every row is scoped to `owner_id = auth.uid()`.

### 6. Deploy to GitHub Pages

The app is published at:

**<https://rachel-huynh.github.io/library/courses.html>**

1. Push this folder to the GitHub repository named **`library`** under `rachel-huynh`.
2. **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*,
   Branch = `main`, Folder = `/ (root)`. Save.
3. The page is live at the URL above within a minute or two.
4. Make sure that exact URL is in the Supabase redirect list (step 4).

There is no `index.html`, so `https://rachel-huynh.github.io/library/` itself returns 404 —
bookmark the `courses.html` URL. (Add an `index.html` that redirects if you ever want the bare
folder URL to work.)

### Running locally

No build step, but ES modules need a real HTTP server — opening `courses.html` as a `file://`
URL will not work, and neither Python nor Node is installed on this machine. `serve.ps1` covers
it with nothing to install:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1
```

Then open <http://localhost:8123/>, which serves `courses.html`. Pass `-Port 9000` to change the
port; whichever port you use, add `http://localhost:<port>/courses.html` to the Supabase redirect
URLs (step 4). The **Live Server** VS Code extension works too.

## Data model in one paragraph

`topics` is a 2–3 level tree (Domain → Topic → Subtopic) with bilingual names. Each `item`
belongs to at most one topic, carries a `kind`, a `status`, an optional `rating`, a `summary`
and `takeaways`, and either a `url` or an uploaded `file_path`. Free-form `tags` cross-cut the
tree. `notes` hang off an item with a `locator` (page number or video timestamp). `item_links`
records relations between items. A generated `fts` column indexes title, alternative title,
authors, summary and takeaways through `unaccent`, which is what makes accent-free searching work.

## Defaults chosen where the spec was silent

- `topics` and `tags` carry their own `owner_id` (they are not children of `items`, so RLS needs it).
- `kind` / `status` / `lang` are `text` with `CHECK` constraints rather than Postgres enums —
  easier to extend later from a static client.
- `fts` uses the `simple` dictionary (no stemming) because the corpus is bilingual EN/VI.
- Search results are ranked with `ts_rank` and weighted: title A, authors B, summary/takeaways C.
- Uploads are namespaced `<uid>/<item-id>/<filename>`; storage policies check the first path segment.
- `topic_counts()` returns both the direct count and the whole-subtree count per topic, so the
  dashboard can dim empty branches without extra round-trips.
- The spec named no screen for editing the topic tree, so the dashboard's knowledge map has a
  **Manage topics** button (create / rename / delete in a modal); slugs are generated from the
  English name.
- The dashboard's month histogram covers the last 12 months, zero-filled so quiet months stay visible.

## Bulk import of the TRAINING MATERIALS folder

`import.html` is a one-off tool for loading the existing archive. Open it while signed in,
pick the `TRAINING MATERIALS` folder, and it creates the topic tree and one item per file,
uploading each attachment straight from your machine to Supabase Storage.

- `import-manifest.json` holds the curated catalogue: the topic tree, and for each file a
  cleaned-up title, kind, language, tags and target topic. Edit it before running if you want
  different titles or groupings.
- **Dry run is on by default** — it logs exactly what would happen without writing anything.
- Re-running is safe: an item whose title already exists under the same topic is skipped.
- Files over the 50 MB per-file limit on Supabase's free tier are catalogued without an
  attachment, with the original path recorded in the summary.
- `learned_on` is taken from each file's modified date, as the closest available proxy for when
  the material was studied. Correct it per item afterwards if it matters.
- Excluded deliberately: the Anaconda installer (software, not material), two PayPal receipts,
  and duplicate copies — byte-identical files and personalised reprints of the same reading are
  catalogued once.

## Searchable document content

`supabase/migration-content.sql` adds `items.content`, `items.keywords` and folds the document
body into the full-text index. Run it in the SQL Editor after `schema.sql`.

The import page then reads each PDF locally and writes back:

- **content** — the full text, indexed at weight D so title and author matches still rank above
  a passing mention in the body.
- **keywords** — top terms by tf-idf across the whole batch, so words common to every eCornell
  PDF ("hotel", "revenue") sink and the distinctive ones rise. Shown as *Key topics* on the item;
  clicking one searches for it.
- **summary** — an extractive summary: the highest-scoring sentences in document order, with
  cover-page and copyright boilerplate filtered out. A summary you wrote yourself is never
  overwritten.

Extraction reads the PDF's own text layer via pdf.js (about a second for a 5-page file). **OCR**
(Tesseract.js, English + Vietnamese) is a per-page fallback for scans only — it downloads a
~15 MB engine and takes seconds per page, so it is off by default.

Search results show a snippet from wherever the hit landed, with matches marked. Snippets are
generated from the unaccented text, so a Vietnamese snippet comes back without tone marks; the
highlighting is still correct.

## Knowledge map

The dashboard's map has three views over the same topic tree, switched in its header:

- **Tree** — the nested list, with subtree counts. Empty branches dimmed.
- **Mindmap** — a radial map drawn outward from the library. Node area grows with the square
  root of the item count; a domain's share of the circle is proportional to how many subtopics
  it has, so a six-module course is not crushed into the same wedge as an empty folder.
  Subtopics alternate between two rings so neighbouring labels never collide.
- **Connections** — the topics on a ring, joined wherever they share extracted key topics.
  This is the view that shows the archive as one connected body rather than separate folders:
  *Forecasting* and *Overbooking* are siblings in the tree, but the chord between them is drawn
  from the vocabulary they actually share. Line thickness is the size of the overlap; an amber
  line means an explicit "related material" link between items, not just shared words.

Every node is clickable and opens the Library filtered to that branch, and both views are
keyboard reachable.

Connections need `supabase/migration-graph.sql` (run it after `migration-content.sql`) and
extracted keywords — until you have run the extraction, that view will be empty.

Layouts are computed rather than force-simulated, so the same data always draws the same
picture and you can see what actually changed between visits.

## After every deploy: hard refresh

GitHub Pages serves scripts with `Cache-Control: max-age=600`, so for about ten minutes after a
push your browser keeps running the previous version of the JavaScript — even though the files
on the server have changed. A stale module can hang the page with no error in the console.

Press **Ctrl+F5** (Ctrl+Shift+R) after pushing. `config.js` carries a `BUILD` stamp that is
logged to the console on boot and shown on the import page, so you can always tell which version
the browser is actually running.
