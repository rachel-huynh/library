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

// "a", "A" and "I" are the only single letters that stand alone as words, so a
// fragment after them is only rejoined when it is not itself a word. This list
// covers what actually follows them in prose - without it, "a product" silently
// becomes "aproduct".
const WORDS_AFTER_ARTICLE = new Set(`
product products service services person people thing things time times way ways
lot lots bit few number numbers result results value values price prices rate rates
room rooms hotel hotels guest guests customer customers market markets model models
report reports system systems process project projects course courses book page day
week month year part point points case cases group set list note plan goal need
company business team member level line unit type kind form range share cost total
am is was were will would can could shall should must may might do did does done
have has had need want think know feel see say make take give find use used using
good great small large long short high low new big single simple second third
different similar specific certain given common major minor final same other such
more most less least very much many both each every all any some no not only
`.trim().split(/\s+/));

// Real two-letter words plus units, which must never absorb the next word.
const TWO_LETTER_WORDS = new Set(`
am an as at be by do go he if in is it me my no of on or so to up us we
ad ax ex ok oh ah hi ha re id tv pc os ui ai ml kg cm mm km lb oz ft hr pm
`.trim().split(/\s+/));

/**
 * PDF text layers split words in two ways:
 *   - drop caps, leaving a detached capital ("D uration")
 *   - letter spacing for justification ("r evenue", "la rgest")
 * Both break search - "revenue" will not match "r evenue" - so a word cut near
 * its start is rejoined, conservatively enough not to fuse real words together.
 */
export function cleanExtractedText(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    // Hyphenation across a line break: "manage- ment".
    .replace(/([a-z])-\s+([a-z]{2,})\b/g, '$1$2')
    // Any single letter other than a/A/I is never a word: always rejoin.
    .replace(/\b([B-HJ-Zb-hj-z]) ([a-z]{2,})\b/g, '$1$2')
    // a / A / I: rejoin only when the remainder is not a word of its own.
    .replace(/\b([aAI]) ([a-z]{2,})\b/g, (match, letter, rest) =>
      WORDS_AFTER_ARTICLE.has(rest) ? match : letter + rest)
    // Two-letter starts: "la rgest" -> "largest", but never "of course".
    .replace(/\b([a-z]{2}) ([a-z]{3,})\b/g, (match, prefix, rest) =>
      TWO_LETTER_WORDS.has(prefix) || WORDS_AFTER_ARTICLE.has(prefix) ? match : prefix + rest)
    .trim();
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
    let pageText = cleanExtractedText(content.items.map((item) => item.str).join(' '));

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
export function summarise(text, keywords, { sentences = 5, bullets = true } = {}) {
  const clean = cleanExtractedText(text);
  if (!clean) return '';

  const weight = new Map(keywords.map((term, index) => [term, keywords.length - index]));
  const candidates = clean
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'À-ỹ])/)
    .map((sentence, index) => ({ sentence: sentence.trim(), index }))
    .filter(({ sentence }) =>
      sentence.length >= 60 && sentence.length <= 400 && !BOILERPLATE.test(sentence));

  if (!candidates.length) return clean.slice(0, 900);

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

  const picked = scored.map((s) => tidySentence(s.sentence));
  // One point per line, so the item page can render it as a real list.
  return bullets ? picked.map((line) => `- ${line}`).join('\n') : picked.join(' ');
}

/** Trim the leading list numbers and stray punctuation that survive extraction. */
function tidySentence(sentence) {
  let out = sentence
    .replace(/^[\s•\-–]*\d{1,2}[.)]?\s+/, '')
    .replace(/^[\s•\-–]+/, '')
    .trim();
  if (out && !/[.!?]$/.test(out)) out += '.';
  return out.charAt(0).toUpperCase() + out.slice(1);
}
