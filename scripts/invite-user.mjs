// Local-only admin tool: invites one friend by email using the service_role
// key. This NEVER runs in the browser and is NEVER deployed — the
// service_role key bypasses RLS entirely, so it must never reach a client.
//
// Usage:
//   cd scripts && npm install   (once)
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx node invite-user.mjs friend@example.com

import { createClient } from '@supabase/supabase-js';

const email = process.argv[2];
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!email) {
  console.error('Usage: node invite-user.mjs <email>');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables first.');
  console.error('Find the service_role key in Supabase dashboard → Project Settings → API.');
  console.error('Never commit it, never put it in a browser-facing file.');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
if (error) {
  console.error('Failed to invite:', error.message);
  process.exit(1);
}

console.log(`Invited ${email}. They will receive an email with a sign-in link.`);
console.log('User id:', data.user.id);
