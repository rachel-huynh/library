// Supabase connection settings.
// Project Settings > API in the Supabase dashboard.
// The anon key is meant to be public: Row Level Security is what protects the data.

export const SUPABASE_URL = 'https://pyfwkojzpmpsguhlkeyr.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_bos37zusS4f_3KfoRTiWnQ_UkHDKhnu';

// Storage bucket created by supabase/schema.sql.
export const STORAGE_BUCKET = 'library';

// Signed URL lifetime for attachments, in seconds.
export const SIGNED_URL_TTL = 60 * 60;

// Rows per page in the Library screen.
export const PAGE_SIZE = 25;
