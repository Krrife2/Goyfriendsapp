// The anon key is meant to be public — Row Level Security in the database is
// the actual access-control boundary, not secrecy of this key. Safe to commit
// and safe to hardcode client-side. Fill these in once the Supabase project
// exists (see README "Prerequisites").
export const SUPABASE_URL = 'https://xdtehgvbmtpvqcecaiaq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_R8QLSJsMqKQEe_tpSnYJNA_Ugno5pAg';

// Public VAPID key for Web Push — not sensitive, this is what lets the browser
// verify a push message actually came from our server. Must match the
// hardcoded public key in supabase/functions/notify-message/index.ts.
export const VAPID_PUBLIC_KEY = 'BAzh9mAzsLbgZZJ-DNtor8Ib0GAIuYsbTFuepOdxX4YdLoPQWv2tKgexDJ4walIJ9-AKO-EZmOlSoZXYQM6Wk0g';
