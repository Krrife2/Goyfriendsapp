// Typing indicators use a Supabase Realtime broadcast channel — nothing is
// written to the database at all. Purely ephemeral, per-conversation, gone
// the moment everyone leaves the channel.

import { sb } from './supabaseClient.js';

const STALE_MS = 5000; // auto-clear a typing indicator if a "stopped" event never arrives

export function joinTypingChannel(conversationId, myUserId, onTypingUsersChange) {
  const typingSince = new Map(); // userId -> timestamp
  let staleTimer = null;

  function notify() {
    onTypingUsersChange(new Set(typingSince.keys()));
  }

  function pruneStale() {
    const cutoff = Date.now() - STALE_MS;
    let changed = false;
    for (const [userId, ts] of typingSince) {
      if (ts < cutoff) {
        typingSince.delete(userId);
        changed = true;
      }
    }
    if (changed) notify();
  }

  const channel = sb
    .channel(`typing-${conversationId}`)
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload.userId === myUserId) return;
      if (payload.isTyping) typingSince.set(payload.userId, Date.now());
      else typingSince.delete(payload.userId);
      notify();
    })
    .subscribe();

  staleTimer = setInterval(pruneStale, 1000);

  let lastSentAt = 0;
  function sendTyping(isTyping) {
    // Throttle "still typing" pings so every keystroke doesn't hit the network.
    const now = Date.now();
    if (isTyping && now - lastSentAt < 2000) return;
    lastSentAt = now;
    channel.send({ type: 'broadcast', event: 'typing', payload: { userId: myUserId, isTyping } });
  }

  function leave() {
    clearInterval(staleTimer);
    sendTyping(false);
    sb.removeChannel(channel);
  }

  return { sendTyping, leave };
}
