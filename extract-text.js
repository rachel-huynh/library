// PDF text extraction, keywording and extractive summarising - all client side.
//
// Most PDFs here are digital and carry a text layer, which pdf.js reads in
// milliseconds. OCR is the fallback for scans only: it is orders of magnitude
// slower, so it runs per page and only where the text layer came back empty.

// Nothing is imported from a CDN at module load: a blocked or slow CDN would
// stop this module evaluating at all, which silently breaks the page that
// imports it. Everything heavy loads on first use, with a mirror to fall back on.

// jsdelivr first: it serves pdf.js's own prebuilt ESM straight from the package.
// esm.sh has to transform the package on first request, which can stall for a
// minute or more on a cold cache - that is what hung the page originally.
const PDFJS_SOURCES = [
  {
    lib: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs',
    worker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs',
  },
  {
    lib: 'https://esm.sh/pdfjs-dist@4.7.76/build/pdf.mjs',
    worker: 'https://esm.sh/pdfjs-dist@4.7.76/build/pdf.worker.mjs',
  },
];

let pdfjsPromise = null;

async function getPdfjs(onStatus) {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    const failures = [];
    for (const source of PDFJS_SOURCES) {
      try {
        onStatus?.(`loading PDF engine from ${new URL(source.lib).hostname}`);
        const lib = await import(/* @vite-ignore */ source.lib);
        lib.GlobalWorkerOptions.workerSrc = source.worker;
        return lib;
      } catch (error) {
        failures.push(`${new URL(source.lib).hostname}: ${error.message}`);
      }
    }
    pdfjsPromise = null; // let a later attempt retry
    throw new Error(
      `Could not load the PDF engine from any CDN. Check whether your network blocks them. Tried - ${failures.join('; ')}`
    );
  })();
  return pdfjsPromise;
}

/** True when the PDF engine is reachable; used to warn before a long run. */
export async function pdfEngineAvailable() {
  try {
    await getPdfjs();
    return true;
  } catch {
    return false;
  }
}

let tesseractWorker = null;

/** Loaded on demand - the OCR engine and its language data are tens of MB. */
async function getOcrWorker(onStatus) {
  if (tesseractWorker) return tesseractWorker;
  onStatus?.('loading OCR engine (one-off, ~15 MB)');
  const { createWorker } = await import('https://esm.sh/tesseract.js@5.1.1');
  tesseractWorker = await createWorker(['eng', 'vie']);
  return tesseractWorker;
}

export async function disposeOcr() {
  await tesseractWorker?.terminate();
  tesseractWorker = null;
}

const MIN_CHARS_PER_PAGE = 24; // below this a page is treated as image-only

/**
 * Drop caps land in the text layer as a detached letter ("D uration").
 * A and I are skipped, since "A book" and "I think" are real.
 */
function fixDropCaps(text) {
  return text.replace(/\b([B-HJ-Z]) ([a-z]{2,})\b/g, '$1$2');
}

/**
 * Pull the text out of a PDF.
 * @returns {{ text: string, pages: number, method: 'text-layer'|'ocr'|'mixed'|'empty' }}
 */
export async function extractPdfText(file, { ocr = false, maxPages = 400, onProgress } = {}) {
  const pdfjs = await getPdfjs((note) => onProgress?.(null, null, note));
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, disableFontFace: true }).promise;
  const pageCount = Math.min(doc.numPages, maxPages);

  const chunks = [];
  let ocrPages = 0;
  let textPages = 0;

  for (let n = 1; n <= pageCount; n += 1) {
    onProgress?.(n, pageCount);
    const page = await doc.getPage(n);

    const content = await page.getTextContent();
    let pageText = fixDropCaps(content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim());

    if (pageText.length >= MIN_CHARS_PER_PAGE) {
      textPages += 1;
    } else if (ocr) {
      pageText = await ocrPage(page, onProgress);
      if (pageText) ocrPages += 1;
    }

    if (pageText) chunks.push(pageText);
    page.cleanup();
  }

  await doc.destroy();

  const method = ocrPages && textPages ? 'mixed' : ocrPages ? 'ocr' : textPages ? 'text-layer' : 'empty';
  return { text: chunks.join('\n\n'), pages: pageCount, method };
}

async function ocrPage(page, onProgress) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

  const worker = await getOcrWorker((msg) => onProgress?.(null, null, msg));
  const { data } = await worker.recognize(canvas);
  canvas.width = 0;
  canvas.height = 0;
  return (data.text ?? '').replace(/\s+/g, ' ').trim();
}

// --------------------------------------------------------------------------
// Keywords and summary
// --------------------------------------------------------------------------

const STOPWORDS = new Set(`
a an the and or but if then than that this these those it its is are was were be been being am
of to in for on with at by from as into over under again further once here there when where why how
all any both each few more most other some such no nor not only own same so too very can will just
should now do does did doing done have has had having would could may might must shall about after
before between during without within across per via using used use one two three first second next
page pages chapter section figure table appendix copyright reserved rights reprint reprinted
you your yours we our ours they them their he she his her i me my
va la cua co duoc cho cac nhung trong voi de khi nay do mot nguoi khong da se tai tu theo ve
nhu cung nen phai boi vi ra len xuong sau truoc giua con nhieu it moi tat ca
`.trim().split(/\s+/));

function tokenise(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && token.length <= 24 && !/^\d+$/.test(token) && !STOPWORDS.has(token));
}

/** Document frequency across the whole batch, so corpus-wide words score low. */
export function buildDocumentFrequency(texts) {
  const df = new Map();
  for (const text of texts) {
    for (const token of new Set(tokenise(text))) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return { df, docCount: texts.length };
}

/** Top terms by tf-idf. Returns them in the document's own casing where possible. */
export function extractKeywords(text, { df, docCount }, limit = 12) {
  const tokens = tokenise(text);
  if (!tokens.length) return [];

  const tf = new Map();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);

  const scored = [...tf.entries()]
    .filter(([, count]) => count >= 2)
    .map(([term, count]) => {
      const idf = Math.log((docCount + 1) / ((df.get(term) ?? 0) + 1)) + 1;
      return [term, (count / tokens.length) * idf];
    })
    .sort((a, b) => b[1] - a[1]);

  return scored.slice(0, limit).map(([term]) => term);
}

// Cover pages and footers repeat on every course PDF and would otherwise win on
// term frequency alone, so they never become summary sentences.
const BOILERPLATE = /copyright|all rights reserved|©\s*\d{4}|trademarks?|ecornell|cornell university school of hotel administration|this material may not be|printed in the|confidential|page \d+ of \d+/i;

/**
 * Extractive summary: score each sentence by the keywords it carries, keep the
 * best few, and put them back in document order so it still reads as prose.
 */
export function summarise(text, keywords, { sentences = 3, maxChars = 700 } = {}) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';

  const weight = new Map(keywords.map((term, index) => [term, keywords.length - index]));
  const candidates = clean
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'À-ỹ])/)
    .map((sentence, index) => ({ sentence: sentence.trim(), index }))
    .filter(({ sentence }) =>
      sentence.length >= 60 && sentence.length <= 400 && !BOILERPLATE.test(sentence));

  if (!candidates.length) return clean.slice(0, maxChars);

  const scored = candidates
    .map((candidate) => {
      const seen = new Set(tokenise(candidate.sentence));
      let score = 0;
      for (const term of seen) score += weight.get(term) ?? 0;
      return { ...candidate, score: score / Math.sqrt(candidate.sentence.length) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, sentences)
    .sort((a, b) => a.index - b.index);

  let out = scored.map((s) => s.sentence).join(' ');
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 1).trimEnd()}…`;
  return out;
}
