// Runtime UI language. English is the base; Vietnamese is a second layer over the
// same code. No visible string is hardcoded in HTML or JS - everything goes through t().

const STORAGE_KEY = 'kl.lang';
export const LANGUAGES = ['en', 'vi'];

const strings = {
  en: {
    'app.name': 'Knowledge Library',
    'app.tagline': 'Everything I have learned, in one place',

    'nav.dashboard': 'Dashboard',
    'nav.library': 'Library',
    'nav.search': 'Search',
    'nav.add': 'Add item',
    'nav.signOut': 'Sign out',
    'nav.language': 'Language',

    'auth.title': 'Sign in',
    'auth.intro': 'Enter your email and we will send you a one-time sign-in link.',
    'auth.email': 'Email address',
    'auth.send': 'Send magic link',
    'auth.sending': 'Sending link...',
    'auth.sent': 'Check your inbox for the sign-in link.',
    'auth.checking': 'Checking your session...',
    'auth.configMissing': 'Supabase is not configured yet. Fill in config.js with your project URL and anon key.',

    'common.loading': 'Loading...',
    'common.saving': 'Saving...',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.edit': 'Edit',
    'common.delete': 'Delete',
    'common.confirmDelete': 'Delete this permanently?',
    'common.retry': 'Try again',
    'common.none': 'None',
    'common.all': 'All',
    'common.empty': 'Nothing here yet.',
    'common.error': 'Something went wrong.',
    'common.results': 'results',
    'common.of': 'of',
    'common.page': 'Page',
    'common.previous': 'Previous',
    'common.next': 'Next',
    'common.clear': 'Clear',
    'common.apply': 'Apply',
    'common.optional': 'optional',

    'item.title': 'Title',
    'item.titleAlt': 'Title (translation)',
    'item.lang': 'Language',
    'item.kind': 'Kind',
    'item.status': 'Status',
    'item.authors': 'Authors',
    'item.source': 'Source',
    'item.url': 'Link',
    'item.file': 'Attachment',
    'item.year': 'Year',
    'item.topic': 'Topic',
    'item.tags': 'Tags',
    'item.rating': 'Rating',
    'item.summary': 'Summary',
    'item.takeaways': 'Key takeaways',
    'item.learnedOn': 'Studied on',
    'item.createdAt': 'Added',
    'item.updatedAt': 'Last touched',
    'item.related': 'Related material',
    'item.notes': 'Notes and highlights',
    'item.keywords': 'Key topics',
    'item.extractedFrom': 'Extracted from {pages} pages via {method}.',
    'item.method.text-layer': 'the PDF text layer',
    'item.method.ocr': 'OCR',
    'item.method.mixed': 'text layer + OCR',
    'item.method.manual': 'manual entry',
    'item.noteLocator': 'Page / timestamp',
    'item.noteBody': 'Note',
    'item.addNote': 'Add note',
    'item.download': 'Download',
    'item.openLink': 'Open link',
    'item.noFile': 'No attachment',

    'kind.slide': 'Slides',
    'kind.lecture': 'Lecture',
    'kind.note': 'Note',
    'kind.paper': 'Paper',
    'kind.book': 'Book',
    'kind.video': 'Video',
    'kind.course': 'Course',
    'kind.other': 'Other',

    'status.inbox': 'Inbox',
    'status.learning': 'Learning',
    'status.done': 'Done',
    'status.archived': 'Archived',

    'lang.en': 'English',
    'lang.vi': 'Vietnamese',
    'lang.other': 'Other',

    'library.title': 'Library',
    'library.filters': 'Filters',
    'library.sort': 'Sort by',
    'library.view.table': 'Table',
    'library.view.cards': 'Cards',
    'library.minRating': 'Minimum rating',
    'library.includeSubtopics': 'Include subtopics',
    'library.empty': 'No items match these filters.',

    'search.title': 'Search',
    'search.placeholder': 'Search titles, authors, summaries, takeaways...',
    'search.hint': 'Accents are optional - "kiem toan" finds "Kiem toan".',
    'search.empty': 'No matches.',
    'search.fallback': 'Showing partial-word matches.',
    'search.inDocument': 'match inside document',

    'form.newItem': 'New item',
    'form.editItem': 'Edit item',
    'form.dropFile': 'Drop a file here, or click to choose',
    'form.uploading': 'Uploading...',
    'form.replaceFile': 'Replace file',
    'form.removeFile': 'Remove file',
    'form.tagsHint': 'Comma-separated. Existing tags are suggested as you type.',
    'form.saved': 'Saved.',

    'dash.title': 'Overview',
    'dash.totalItems': 'Items',
    'dash.learning': 'Learning',
    'dash.done': 'Done',
    'dash.notes': 'Notes',
    'dash.topicTree': 'Knowledge map',
    'dash.gapsHint': 'Dimmed branches hold nothing yet - those are the gaps.',
    'dash.viewTree': 'Tree',
    'dash.viewMindmap': 'Mindmap',
    'dash.viewGraph': 'Connections',
    'dash.mindmapAria': 'Mindmap of {count} topics',
    'dash.graphAria': 'Connection graph, {nodes} topics and {edges} links',
    'dash.sharedTerms': 'shared key topics',
    'dash.graphEmpty': 'No connections yet. Extract text from your PDFs first - links are built from shared key topics.',
    'dash.graphHint': 'Each line joins two topics that share key topics. Thicker means more overlap.',
    'dash.byMonth': 'Studied by month',
    'dash.byKind': 'By kind',
    'dash.currentlyLearning': 'Currently learning',
    'dash.leastRecent': 'Least recently revisited',
    'dash.noTopics': 'No topics yet. Add one to start mapping your domains.',
    'topic.manage': 'Manage topics',
    'topic.add': 'Add topic',
    'topic.nameEn': 'Name (English)',
    'topic.nameVi': 'Name (Vietnamese)',
    'topic.parent': 'Parent topic',
    'topic.color': 'Colour',
    'topic.sort': 'Order',
    'topic.deleteWarning': 'Deleting a topic also deletes its subtopics. Items keep existing but lose their topic.',

    'shortcut.title': 'Shortcuts',
    'shortcut.search': 'focus search',
    'shortcut.new': 'new item',
    'shortcut.close': 'close dialog',
  },

  vi: {
    'app.name': 'Thư viện tri thức',
    'app.tagline': 'Tất cả những gì tôi đã học, ở một nơi',

    'nav.dashboard': 'Tổng quan',
    'nav.library': 'Thư viện',
    'nav.search': 'Tìm kiếm',
    'nav.add': 'Thêm tài liệu',
    'nav.signOut': 'Đăng xuất',
    'nav.language': 'Ngôn ngữ',

    'auth.title': 'Đăng nhập',
    'auth.intro': 'Nhập email, hệ thống sẽ gửi cho bạn một liên kết đăng nhập một lần.',
    'auth.email': 'Địa chỉ email',
    'auth.send': 'Gửi liên kết đăng nhập',
    'auth.sending': 'Đang gửi...',
    'auth.sent': 'Hãy kiểm tra hộp thư để lấy liên kết đăng nhập.',
    'auth.checking': 'Đang kiểm tra phiên đăng nhập...',
    'auth.configMissing': 'Chưa cấu hình Supabase. Hãy điền URL dự án và anon key vào config.js.',

    'common.loading': 'Đang tải...',
    'common.saving': 'Đang lưu...',
    'common.save': 'Lưu',
    'common.cancel': 'Hủy',
    'common.close': 'Đóng',
    'common.edit': 'Sửa',
    'common.delete': 'Xóa',
    'common.confirmDelete': 'Xóa vĩnh viễn mục này?',
    'common.retry': 'Thử lại',
    'common.none': 'Không có',
    'common.all': 'Tất cả',
    'common.empty': 'Chưa có gì ở đây.',
    'common.error': 'Đã xảy ra lỗi.',
    'common.results': 'kết quả',
    'common.of': 'trên',
    'common.page': 'Trang',
    'common.previous': 'Trước',
    'common.next': 'Sau',
    'common.clear': 'Xóa bộ lọc',
    'common.apply': 'Áp dụng',
    'common.optional': 'không bắt buộc',

    'item.title': 'Tiêu đề',
    'item.titleAlt': 'Tiêu đề (bản dịch)',
    'item.lang': 'Ngôn ngữ',
    'item.kind': 'Loại',
    'item.status': 'Trạng thái',
    'item.authors': 'Tác giả',
    'item.source': 'Nguồn',
    'item.url': 'Liên kết',
    'item.file': 'Tệp đính kèm',
    'item.year': 'Năm',
    'item.topic': 'Chủ đề',
    'item.tags': 'Thẻ',
    'item.rating': 'Đánh giá',
    'item.summary': 'Tóm tắt',
    'item.takeaways': 'Điểm cốt lõi',
    'item.learnedOn': 'Ngày học',
    'item.createdAt': 'Ngày thêm',
    'item.updatedAt': 'Cập nhật gần nhất',
    'item.related': 'Tài liệu liên quan',
    'item.notes': 'Ghi chú và trích dẫn',
    'item.keywords': 'Chủ đề chính',
    'item.extractedFrom': 'Trích xuất từ {pages} trang bằng {method}.',
    'item.method.text-layer': 'lớp văn bản PDF',
    'item.method.ocr': 'OCR',
    'item.method.mixed': 'lớp văn bản + OCR',
    'item.method.manual': 'nhập thủ công',
    'item.noteLocator': 'Trang / mốc thời gian',
    'item.noteBody': 'Ghi chú',
    'item.addNote': 'Thêm ghi chú',
    'item.download': 'Tải xuống',
    'item.openLink': 'Mở liên kết',
    'item.noFile': 'Không có tệp đính kèm',

    'kind.slide': 'Slide',
    'kind.lecture': 'Bài giảng',
    'kind.note': 'Ghi chú',
    'kind.paper': 'Bài báo',
    'kind.book': 'Sách',
    'kind.video': 'Video',
    'kind.course': 'Khóa học',
    'kind.other': 'Khác',

    'status.inbox': 'Chờ xử lý',
    'status.learning': 'Đang học',
    'status.done': 'Đã xong',
    'status.archived': 'Lưu trữ',

    'lang.en': 'Tiếng Anh',
    'lang.vi': 'Tiếng Việt',
    'lang.other': 'Khác',

    'library.title': 'Thư viện',
    'library.filters': 'Bộ lọc',
    'library.sort': 'Sắp xếp theo',
    'library.view.table': 'Bảng',
    'library.view.cards': 'Thẻ',
    'library.minRating': 'Đánh giá tối thiểu',
    'library.includeSubtopics': 'Gồm cả chủ đề con',
    'library.empty': 'Không có tài liệu nào khớp bộ lọc.',

    'search.title': 'Tìm kiếm',
    'search.placeholder': 'Tìm theo tiêu đề, tác giả, tóm tắt, điểm cốt lõi...',
    'search.hint': 'Không cần dấu - gõ "kiem toan" vẫn ra "Kiểm toán".',
    'search.empty': 'Không tìm thấy kết quả.',
    'search.fallback': 'Đang hiển thị kết quả khớp một phần từ.',
    'search.inDocument': 'khớp trong nội dung tệp',

    'form.newItem': 'Tài liệu mới',
    'form.editItem': 'Sửa tài liệu',
    'form.dropFile': 'Kéo thả tệp vào đây, hoặc bấm để chọn',
    'form.uploading': 'Đang tải lên...',
    'form.replaceFile': 'Thay tệp khác',
    'form.removeFile': 'Gỡ tệp',
    'form.tagsHint': 'Ngăn cách bằng dấu phẩy. Các thẻ đã có sẽ được gợi ý khi gõ.',
    'form.saved': 'Đã lưu.',

    'dash.title': 'Tổng quan',
    'dash.totalItems': 'Tài liệu',
    'dash.learning': 'Đang học',
    'dash.done': 'Đã xong',
    'dash.notes': 'Ghi chú',
    'dash.topicTree': 'Bản đồ tri thức',
    'dash.gapsHint': 'Nhánh mờ là nhánh chưa có tài liệu - đó là khoảng trống.',
    'dash.viewTree': 'Cây',
    'dash.viewMindmap': 'Sơ đồ tư duy',
    'dash.viewGraph': 'Liên kết',
    'dash.mindmapAria': 'Sơ đồ tư duy gồm {count} chủ đề',
    'dash.graphAria': 'Đồ thị liên kết, {nodes} chủ đề và {edges} liên kết',
    'dash.sharedTerms': 'chủ đề chính dùng chung',
    'dash.graphEmpty': 'Chưa có liên kết. Hãy trích xuất nội dung PDF trước - liên kết dựa trên chủ đề chính dùng chung.',
    'dash.graphHint': 'Mỗi đường nối hai chủ đề có chung từ khóa. Càng dày càng trùng nhiều.',
    'dash.byMonth': 'Theo tháng',
    'dash.byKind': 'Theo loại',
    'dash.currentlyLearning': 'Đang học',
    'dash.leastRecent': 'Lâu chưa xem lại',
    'dash.noTopics': 'Chưa có chủ đề nào. Thêm một chủ đề để bắt đầu vẽ bản đồ.',
    'topic.manage': 'Quản lý chủ đề',
    'topic.add': 'Thêm chủ đề',
    'topic.nameEn': 'Tên (tiếng Anh)',
    'topic.nameVi': 'Tên (tiếng Việt)',
    'topic.parent': 'Chủ đề cha',
    'topic.color': 'Màu',
    'topic.sort': 'Thứ tự',
    'topic.deleteWarning': 'Xóa một chủ đề sẽ xóa cả các chủ đề con. Tài liệu vẫn còn nhưng mất chủ đề.',

    'shortcut.title': 'Phím tắt',
    'shortcut.search': 'tới ô tìm kiếm',
    'shortcut.new': 'tài liệu mới',
    'shortcut.close': 'đóng hộp thoại',
  },
};

let current = readStoredLang();
const listeners = new Set();

function readStoredLang() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.includes(stored)) return stored;
  } catch {
    /* localStorage unavailable - fall through to the default */
  }
  return 'en';
}

export function getLang() {
  return current;
}

export function setLang(lang) {
  if (!LANGUAGES.includes(lang) || lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore - the choice simply will not persist */
  }
  document.documentElement.lang = lang;
  applyTranslations();
  listeners.forEach((fn) => fn(lang));
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Translate a key. Unknown keys fall back to English, then to the key itself. */
export function t(key, vars) {
  let text = strings[current]?.[key] ?? strings.en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** Pick the right side of a bilingual data pair (topic names, item titles). */
export function pick(primary, alternate) {
  if (current === 'vi') return alternate || primary || '';
  return primary || alternate || '';
}

export function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(current === 'vi' ? 'vi-VN' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function formatMonth(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(current === 'vi' ? 'vi-VN' : 'en-GB', {
    month: 'short',
    year: '2-digit',
  });
}

/**
 * Swap every translatable string in the DOM.
 * Markup declares keys with data-i18n, data-i18n-placeholder, data-i18n-title,
 * data-i18n-aria-label.
 */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
}
