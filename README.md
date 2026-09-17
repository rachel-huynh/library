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
