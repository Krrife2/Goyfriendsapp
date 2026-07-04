// Transport layer only — this module never sees plaintext or conversation
// keys. It hands raw (still-encrypted) rows to the caller, which decrypts
// after fetch/receive. Pattern adapted from the Rivital messaging app:
// Realtime subscription + polling safety net + backoff reconnect + resync on
// resume, so messages never get stuck if a Realtime event is dropped.

import { sb } from './supabaseClient.js';

const POLL_INTERVAL_MS = 12000;
const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 8000, 8000];

// callbacks: onMessageInsert(row), onReactionChange(payload), onResync()
// onResync is called after (re)connecting, on the polling timer, when the tab
// is foregrounded, and when the network comes back online — it should re-fetch
// and reconcile by id, not assume anything about what was missed.
export function startRealtime(callbacks) {
  const { onMessageInsert, onReactionChange, onResync } = callbacks;
  let channel = null;
  let backoffAttempt = 0;
  let backoffTimer = null;
  let stopped = false;

  function scheduleReconnect() {
    if (stopped) return;
    const delay = BACKOFF_STEPS_MS[Math.min(backoffAttempt, BACKOFF_STEPS_MS.length - 1)];
    backoffAttempt++;
    clearTimeout(backoffTimer);
    backoffTimer = setTimeout(subscribe, delay);
  }

  function subscribe() {
    if (stopped) return;
    if (channel) sb.removeChannel(channel);
    channel = sb
      .channel('goyfriends-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        onMessageInsert && onMessageInsert(payload.new);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload) => {
        onReactionChange && onReactionChange(payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          backoffAttempt = 0;
          onResync && onResync();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          scheduleReconnect();
        }
      });
  }

  subscribe();

  const pollTimer = setInterval(() => onResync && onResync(), POLL_INTERVAL_MS);

  function handleVisibility() {
    if (document.visibilityState === 'visible') onResync && onResync();
  }
  function handleOnline() {
    onResync && onResync();
  }
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('online', handleOnline);

  return function stop() {
    stopped = true;
    clearInterval(pollTimer);
    clearTimeout(backoffTimer);
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('online', handleOnline);
    if (channel) sb.removeChannel(channel);
  };
}
