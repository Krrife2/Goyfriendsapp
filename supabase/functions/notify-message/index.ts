// Triggered internally by the messages-insert database trigger (see
// supabase/migrations/0004_push_trigger.sql), never called by clients
// directly. Authenticated via a shared secret (not a user JWT) checked
// against Vault, which is why this function is deployed with verify_jwt=false.
//
// Sends GENERIC push previews only — sender name and conversation title are
// ordinary server-visible metadata, but the message body is end-to-end
// encrypted and this function never has the key to read it. The push
// preview never contains message content, by design.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // vault.decrypted_secrets isn't reachable directly through the REST client
  // (only `public` is exposed) — get_webhook_secrets() is a narrow RPC,
  // grantable only to service_role, that wraps just these two values.
  const { data: secrets } = await sb.rpc("get_webhook_secrets");
  const expectedSecret = secrets?.webhook_secret as string | undefined;
  const vapidPrivateKey = secrets?.vapid_private_key as string | undefined;

  if (!expectedSecret || req.headers.get("x-webhook-secret") !== expectedSecret) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!vapidPrivateKey) {
    return new Response("vapid private key not configured", { status: 500 });
  }

  const { message_id, conversation_id, sender } = await req.json();

  // Public key is not sensitive — it's what browsers use to verify push messages
  // came from us. Safe to hardcode; must match js/config.js's VAPID_PUBLIC_KEY.
  const vapidPublicKey = "BAzh9mAzsLbgZZJ-DNtor8Ib0GAIuYsbTFuepOdxX4YdLoPQWv2tKgexDJ4walIJ9-AKO-EZmOlSoZXYQM6Wk0g";
  webpush.setVapidDetails("mailto:admin@goyfriendsapp.netlify.app", vapidPublicKey, vapidPrivateKey);

  const [{ data: senderProfile }, { data: conversation }, { data: members }] = await Promise.all([
    sb.from("profiles").select("display_name").eq("id", sender).maybeSingle(),
    sb.from("conversations").select("title, is_group").eq("id", conversation_id).maybeSingle(),
    sb.from("conversation_members").select("user_id, muted").eq("conversation_id", conversation_id),
  ]);

  const recipientIds = (members ?? [])
    .filter((m) => m.user_id !== sender && !m.muted)
    .map((m) => m.user_id);
  if (recipientIds.length === 0) return new Response("ok", { status: 200 });

  const { data: subscriptions } = await sb
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth_key")
    .in("user_id", recipientIds);

  const senderName = senderProfile?.display_name || "Someone";
  const title = conversation?.is_group && conversation?.title ? conversation.title : senderName;
  const body = conversation?.is_group ? `${senderName} sent a message` : "sent you a message";

  const payload = JSON.stringify({ title, body, conversationId: conversation_id, messageId: message_id });

  await Promise.all(
    (subscriptions ?? []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        );
      } catch (err) {
        // 404/410 means the browser subscription is gone (uninstalled, expired) — clean it up.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await sb.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    })
  );

  return new Response("ok", { status: 200 });
});
