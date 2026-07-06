# Goyfriends 🐸

A small, invite-only, end-to-end encrypted group chat. iMessage-like, built as
a vanilla HTML/CSS/JS PWA — no build step, no framework. Message content and
attachments are encrypted client-side; the server (Supabase) only ever stores
ciphertext.

Features: bubbles with reply-quotes and tapback reactions, group naming/photos
(editable by any member), push notifications, typing indicators, opt-in read
receipts (off by default), message edit/unsend, pinned/muted conversations,
profile photos/avatars, key backup/restore, WebAuthn quick-unlock, voice
messages, and iMessage-style bubble/screen send effects (Slam, Loud, Gentle,
Invisible Ink, Balloons, Confetti, Love — hold the send button to pick one).
The composer itself mirrors iMessage: tap send to send, hold send for
effects, hold the mic to record a voice message, attach is always available.

## Security model — read this before inviting anyone

**End-to-end encrypted** (only participants can ever read these, not Supabase,
not whoever's hosting the database, not the app's operator):
- Message bodies
- Attachment file content
- Attachment filename and MIME type

**Not end-to-end encrypted** (visible to whoever operates the database — the
same boundary essentially every mainstream messenger draws for account/group
metadata):
- Display names and profile photos
- Group titles and group photos
- Reactions (tapbacks)
- Timestamps, sender identity, who's in which conversation
- Attachment size (inherently visible from the ciphertext blob size anyway)
- Whether a message was edited/unsent (the content itself stays encrypted;
  unsending just stops the client from ever rendering that row again)
- Read receipts, if you turn them on (off by default — see below) and pin/mute state
- Typing indicators (never stored — a live broadcast only, gone the instant
  everyone leaves the conversation)
- Which send effect (if any) was chosen for a message — the effect name is
  metadata about presentation, not content; the message body is still
  encrypted separately either way

**Voice messages are encrypted exactly like any other attachment** — recorded
locally, encrypted client-side before upload, same as a photo or file.

**Push notification previews are always generic** — "so-and-so sent a
message," never the actual text. The server-side function that sends push
notifications has no way to decrypt your messages, so it physically cannot
put message content in a notification even if it wanted to.

**Not provided:**
- Per-message forward secrecy. Each conversation uses one static symmetric key
  for its lifetime, not Signal's per-message double-ratchet. If a device's
  private key is ever compromised, that member's historical messages in every
  conversation they're part of become exposed to whoever has both the key and
  database access. (Mitigation available but not built: periodic manual key
  rotation — generate a new conversation key, re-wrap it to all members, use
  it going forward. Old messages stay under the old key.)
- A server-recognized second auth factor. The Face ID/Touch ID/Windows Hello
  "quick unlock" is a local convenience gate on top of an already-valid
  Supabase session — it never talks to Supabase.
- Server-side key recovery. There is no key escrow anywhere — that would
  defeat the whole point. If someone loses their device without a key backup,
  their message history on that identity is gone for good. Nobody, including
  Kent, can recover it.

## Prerequisites (do these once, before anything else)

### 1. Supabase project
1. Log into your existing Supabase account (no new account needed — a new
   project already gets its own database, API keys, and billing, fully
   isolated from any other project on the account).
2. Create a new project named `goyfriends`. Save the database password
   somewhere safe — you won't need it day-to-day, only for direct Postgres
   access if you ever need it.
3. Project Settings → API — copy the **Project URL** and the **anon public
   key**. Paste them into `js/config.js` (`SUPABASE_URL` / `SUPABASE_ANON_KEY`).
   The anon key is meant to be public; Row Level Security is the actual
   access-control boundary, not secrecy of this key.
4. Authentication → Providers — make sure **Email** is enabled.
5. Authentication → URL Configuration — set Site URL to your eventual Netlify
   URL (you'll come back and update this once you have it in step 2 below).
6. Storage — create two buckets:
   - `avatars`
   - `attachments`
7. SQL Editor — run, in order: `supabase/migrations/0001_init.sql`,
   `0002_rls.sql`, `0003_v2_features.sql`, `0004_message_effects.sql`.
8. **Push notifications** — generate a VAPID keypair (any Web Push VAPID
   generator, or Node: `crypto.createECDH('prime256v1')`, base64url-encode
   the public/private keys). Then:
   - Update the hardcoded `vapidPublicKey` in both
     `supabase/functions/notify-message/index.ts` and `js/config.js`
     (`VAPID_PUBLIC_KEY`) to your new public key.
   - Store the private key in Vault via SQL Editor:
     `select vault.create_secret('<your private key>', 'vapid_private_key', '...');`
   - Deploy the Edge Function: `supabase functions deploy notify-message --no-verify-jwt`
     (or via the dashboard's Edge Functions UI, uploading `supabase/functions/notify-message/index.ts`,
     with "Verify JWT" turned **off** — this function authenticates via a
     Vault-stored shared secret checked against the `x-webhook-secret`
     header, not a user JWT).
   - Update the project URL hardcoded in `notify_new_message()` inside
     `0003_v2_features.sql` if you're forking this to a different project.

### 2. Netlify site
1. Log into your existing Netlify account (no new account needed — a new
   site is its own isolated deployment).
2. Push this repo to a private GitHub repo.
3. Netlify → Add new site → Import from Git → pick the repo. No build
   command needed (see `netlify.toml` — it's already configured for a static
   site with `publish = "."`).
4. Note the deployed URL, then go back to Supabase's Authentication → URL
   Configuration and set the Site URL / Redirect URLs to match it.

### 3. Inviting people
Signup is closed — the only way anyone gets an account is via
`scripts/invite-user.mjs`, which uses the `service_role` key (found in
Supabase Project Settings → API). That key bypasses Row Level Security
entirely, so it must **never** be committed or put in any browser-facing
file — it only ever runs locally, in your own terminal.

```
cd scripts
npm install
SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx node invite-user.mjs friend@example.com
```

Each invited friend gets an email with a sign-in link. On first login they'll
set up a display name/photo, generate their device's encryption key, and be
prompted to back it up.

## Local development

This is a plain static site — any static file server works:

```
npx serve .
```

Open the served URL in a browser. There's nothing to build or bundle.

## Repo layout

- `js/crypto/` — the E2E encryption core: identity keys (`keys.js`),
  per-conversation key wrapping (`conversationKeys.js`), message encryption
  (`messageCrypto.js`), attachment encryption (`attachmentCrypto.js`). A bug
  here is a confidentiality bug — keep changes small and test them.
- `js/db/` — Supabase queries, grouped by table/concern.
- `js/ui/` — vanilla-JS render functions, one per screen/component.
- `js/push.js` — Web Push subscribe/unsubscribe (this browser only).
- `js/typing.js` — ephemeral typing-indicator broadcast, never touches the database.
- `js/vendor/` — libsodium and supabase-js, vendored (not CDN-fetched) so the
  PWA shell works offline and doesn't depend on a third party being up.
- `supabase/migrations/` — schema (`0001_init.sql`), RLS (`0002_rls.sql`),
  v2 features: pin/mute, edit/unsend, read receipts, push (`0003_v2_features.sql`).
- `supabase/functions/notify-message/` — Edge Function that sends the actual
  push notifications, triggered by a database trigger on message insert.
- `scripts/invite-user.mjs` — the only way to create an account; local-only.

## Verifying the E2E guarantee yourself

After sending a test message between two accounts, open the Supabase
dashboard's Table Editor and look at the `messages` table. The `ciphertext`
column should be meaningless base64 — not the message text. That's the
concrete proof the encryption is real, not just assumed.
