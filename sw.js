// PWA app-shell caching only — never caches anything from Supabase (a
// different origin entirely, so it's never intercepted here) and never
// caches decrypted message content, since messages are rendered straight
// into the DOM and never round-trip through a fetch this worker sees.
const CACHE_VERSION = 'goyfriends-shell-v2';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/manifest.webmanifest',
  '/js/app.js',
  '/js/config.js',
  '/js/supabaseClient.js',
  '/js/auth.js',
  '/js/push.js',
  '/js/realtime.js',
  '/js/crypto/sodium.js',
  '/js/crypto/keys.js',
  '/js/crypto/conversationKeys.js',
  '/js/crypto/messageCrypto.js',
  '/js/crypto/attachmentCrypto.js',
  '/js/db/profiles.js',
  '/js/db/conversations.js',
  '/js/db/messages.js',
  '/js/db/storage.js',
  '/js/ui/dom.js',
  '/js/ui/avatar.js',
  '/js/ui/onboarding.js',
  '/js/ui/conversationList.js',
  '/js/ui/threadView.js',
  '/js/ui/composer.js',
  '/js/ui/groupInfoSheet.js',
  '/js/ui/profileSettings.js',
  '/js/ui/newConversationModal.js',
  '/js/vendor/libsodium.js',
  '/js/vendor/libsodium-wrappers.js',
  '/js/vendor/supabase.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only ever handle same-origin GETs for the static shell. Everything else
  // (Supabase API/Storage/Realtime, non-GET requests) passes straight through.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});

// Push previews are always generic (see notify-message Edge Function) — the
// server never has the E2E key, so it can never put message content in here.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const { title, body, conversationId } = event.data.json();
  event.waitUntil(
    self.registration.showNotification(title || 'Goyfriends', {
      body: body || 'New message',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { conversationId },
      tag: conversationId || 'goyfriends',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const conversationId = event.notification.data?.conversationId;
  const targetUrl = conversationId ? `/?conversation=${conversationId}` : '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'open-conversation', conversationId });
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
