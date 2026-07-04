// Web Push subscription management. The actual sending happens server-side
// (supabase/functions/notify-message), triggered by a database trigger on
// message insert — this module only handles subscribing/unsubscribing this
// browser and wiring up the notificationclick handler.

import { sb } from './supabaseClient.js';
import { VAPID_PUBLIC_KEY } from './config.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function isPushEnabled() {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return !!existing;
}

export async function enablePush(userId) {
  const registration = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const raw = subscription.toJSON();
  const { error } = await sb.from('push_subscriptions').insert({
    user_id: userId,
    endpoint: raw.endpoint,
    p256dh: raw.keys.p256dh,
    auth_key: raw.keys.auth,
  });
  // A duplicate endpoint (re-enabling on the same browser) isn't an error worth surfacing.
  if (error && error.code !== '23505') throw error;
}

export async function disablePush() {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (!existing) return;
  await sb.from('push_subscriptions').delete().eq('endpoint', existing.endpoint);
  await existing.unsubscribe();
}
