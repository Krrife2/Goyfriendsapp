import { el, clear, formatTime } from './dom.js';
import { renderAvatar } from './avatar.js';
import { renderComposer } from './composer.js';
import { displayTitleFor, avatarPathFor } from './conversationList.js';
import { BUBBLE_EFFECTS, SCREEN_EFFECTS, playScreenEffect, hasPlayedEffect, markEffectPlayed } from '../effects.js';

const QUICK_REACTIONS = ['❤️', '👍', '👎', '😂', '‼️', '❓'];
const attachmentUrlCache = new Map(); // message.id -> blob URL

function findMessage(messages, id) {
  return messages.find((m) => m.id === id);
}

function closeAnyOpenReactionPicker() {
  document.querySelectorAll('.reaction-picker-popup').forEach((n) => n.remove());
}

export function renderThreadView(container, ctx) {
  const {
    conversation,
    myUserId,
    messages,
    reactionsByMessageId,
    readsByMessageId,
    profilesById,
    onBack,
    onOpenGroupInfo,
    onSendText,
    onSendFile,
    replyTarget,
    onSetReplyTarget,
    onCancelReply,
    onReact,
    onEditMessage,
    onUnsendMessage,
    getAttachmentUrl,
    typingUserIds,
    onTyping,
    onSendVoice,
    onOpenEffectPicker,
  } = ctx;

  clear(container);

  if (!conversation) {
    container.appendChild(el('div', { class: 'thread-empty', text: 'Pick a pond, or start a new one. 🐸' }));
    return;
  }

  const title = displayTitleFor(conversation, myUserId);
  const avatarPath = avatarPathFor(conversation, myUserId);

  const header = el('div', { class: 'thread-header', onclick: onOpenGroupInfo }, [
    el('button', {
      class: 'back-button',
      onclick: (e) => {
        e.stopPropagation();
        onBack();
      },
      text: '‹',
    }),
    renderAvatar(avatarPath, title, 'small'),
    el('div', { class: 'conversation-title', text: title }),
  ]);
  container.appendChild(header);

  const listEl = el('div', { class: 'message-list' });
  container.appendChild(listEl);

  const showSenderLabels = conversation.is_group;
  let lastSenderId = null;

  // iMessage-style: only show "Read" under the single most recent own message
  // someone else has read, not on every read message.
  let lastReadOwnMessageId = null;
  for (const message of messages) {
    if (message.sender !== myUserId) continue;
    const reads = (readsByMessageId && readsByMessageId.get(message.id)) || [];
    if (reads.some((r) => r.user_id !== myUserId)) lastReadOwnMessageId = message.id;
  }

  for (const message of messages) {
    const isSelf = message.sender === myUserId;
    const senderProfile = profilesById.get(message.sender);
    const senderName = senderProfile?.display_name || 'Unknown';
    const showLabel = showSenderLabels && !isSelf && message.sender !== lastSenderId;
    lastSenderId = message.sender;

    const row = el('div', { class: `message-row ${isSelf ? 'self' : 'other'}` });

    if (showLabel) {
      row.appendChild(el('div', { class: 'message-sender-label', text: senderName }));
    }

    const bubble = el('div', { class: 'bubble' });

    if (message.deleted_at) {
      bubble.classList.add('decrypt-error');
      bubble.textContent = 'This message was removed.';
    } else if (message.decryptFailed) {
      bubble.classList.add('decrypt-error');
      bubble.textContent = 'Could not decrypt this message on this device.';
    } else {
      if (message.reply_to) {
        const parent = findMessage(messages, message.reply_to);
        if (parent && !parent.decryptFailed) {
          bubble.appendChild(el('div', { class: 'bubble-reply-quote', text: parent.body.slice(0, 80) }));
        }
      }
      if (message.attachment_path) {
        bubble.appendChild(renderAttachment(message, getAttachmentUrl));
      }
      if (message.body) {
        bubble.appendChild(el('div', { text: message.body }));
      }

      if (message.effect) {
        if (message.effect === 'invisible-ink') {
          bubble.classList.add('bubble-effect-invisible-ink');
          bubble.appendChild(el('div', { class: 'invisible-ink-veil' }));
          bubble.addEventListener('click', (e) => {
            e.stopPropagation();
            bubble.classList.toggle('revealed');
          });
        } else if (BUBBLE_EFFECTS.includes(message.effect) && !hasPlayedEffect(message.id)) {
          bubble.classList.add(`bubble-effect-${message.effect}`);
          markEffectPlayed(message.id);
        } else if (SCREEN_EFFECTS.includes(message.effect) && !hasPlayedEffect(message.id)) {
          playScreenEffect(message.effect);
          markEffectPlayed(message.id);
        }
      }
    }

    if (!message.deleted_at) {
      bubble.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        openReactionPicker(bubble, message, onReact);
      });
    }
    row.appendChild(bubble);

    if (isSelf && !message.deleted_at) {
      const optionsButton = el('button', {
        class: 'text-button',
        style: 'font-size:11px;padding:0;align-self:flex-end;',
        onclick: (e) => {
          e.stopPropagation();
          openMessageOptionsMenu(optionsButton, message, onEditMessage, onUnsendMessage);
        },
        text: '⋯',
      });
      row.appendChild(optionsButton);
    }

    const reactions = reactionsByMessageId.get(message.id) || [];
    if (reactions.length > 0) {
      const grouped = new Map();
      for (const r of reactions) grouped.set(r.emoji, (grouped.get(r.emoji) || 0) + 1);
      const reactionsEl = el('div', { class: 'bubble-reactions' });
      for (const [emoji, count] of grouped) {
        reactionsEl.appendChild(el('span', { class: 'reaction-badge', text: count > 1 ? `${emoji} ${count}` : emoji }));
      }
      row.appendChild(reactionsEl);
    }

    const timestampText = message.edited_at && !message.deleted_at
      ? `${formatTime(message.created_at)} · Edited`
      : formatTime(message.created_at);
    row.appendChild(el('div', { class: 'bubble-timestamp', text: timestampText }));
    if (message.id === lastReadOwnMessageId) {
      row.appendChild(el('div', { class: 'bubble-timestamp', text: 'Read' }));
    }

    if (!message.deleted_at) {
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        onSetReplyTarget({ id: message.id, previewText: message.decryptFailed ? '(undecryptable)' : message.body });
      });
    }

    listEl.appendChild(row);
  }

  listEl.scrollTop = listEl.scrollHeight;

  if (typingUserIds && typingUserIds.size > 0) {
    const names = [...typingUserIds].map((id) => profilesById.get(id)?.display_name || 'Someone');
    const label = names.length === 1 ? `${names[0]} is typing…` : `${names.join(', ')} are typing…`;
    container.appendChild(el('div', { class: 'typing-indicator', text: label }));
  }

  const composerContainer = el('div');
  container.appendChild(composerContainer);
  renderComposer(composerContainer, {
    replyTarget,
    onCancelReply,
    onTyping,
    onSendText: (text) => onSendText(text, replyTarget?.id || null),
    onSendFile: (file) => onSendFile(file, replyTarget?.id || null),
    onSendVoice: (blob, durationMs, replyTo) => onSendVoice && onSendVoice(blob, durationMs, replyTo),
    onOpenEffectPicker,
  });
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function renderAttachment(message, getAttachmentUrl) {
  const meta = message.attachmentMeta || { name: 'file', type: '' };
  const isImage = meta.type && meta.type.startsWith('image/');
  const isAudio = meta.type && meta.type.startsWith('audio/');

  if (isImage) {
    const img = el('img', { class: 'attachment-image', alt: meta.name });
    const cached = attachmentUrlCache.get(message.id);
    if (cached) {
      img.src = cached;
    } else {
      getAttachmentUrl(message).then((url) => {
        if (!url) return;
        attachmentUrlCache.set(message.id, url);
        img.src = url;
      });
    }
    return img;
  }

  if (isAudio) {
    const wrapper = el('div', { class: 'attachment-voice' }, [
      el('span', { text: '🎤' }),
      el('audio', { controls: true, class: 'attachment-voice-player' }),
      meta.durationMs ? el('span', { class: 'attachment-voice-duration', text: formatDuration(meta.durationMs) }) : null,
    ]);
    const audioEl = wrapper.querySelector('audio');
    const cached = attachmentUrlCache.get(message.id);
    if (cached) {
      audioEl.src = cached;
    } else {
      getAttachmentUrl(message).then((url) => {
        if (!url) return;
        attachmentUrlCache.set(message.id, url);
        audioEl.src = url;
      });
    }
    return wrapper;
  }

  const link = el('span', { class: 'attachment-file', text: `📄 ${meta.name}` });
  link.addEventListener('click', async (e) => {
    e.stopPropagation();
    const url = attachmentUrlCache.get(message.id) || (await getAttachmentUrl(message));
    if (!url) return;
    attachmentUrlCache.set(message.id, url);
    const a = document.createElement('a');
    a.href = url;
    a.download = meta.name;
    a.click();
  });
  return link;
}

function openMessageOptionsMenu(anchorEl, message, onEditMessage, onUnsendMessage) {
  closeAnyOpenReactionPicker();
  const rect = anchorEl.getBoundingClientRect();
  const popup = el('div', {
    class: 'reaction-picker-popup',
    style: `position:fixed;top:${rect.top - 76}px;left:${rect.left}px;background:var(--panel-bg);border:1px solid var(--border);border-radius:12px;padding:6px;display:flex;flex-direction:column;gap:2px;z-index:100;min-width:110px;`,
  });
  popup.appendChild(
    el('button', {
      class: 'text-button',
      style: 'text-align:left;padding:6px 8px;',
      onclick: () => {
        popup.remove();
        const newText = prompt('Edit message', message.body);
        if (newText != null && newText.trim() && newText.trim() !== message.body) {
          onEditMessage(message.id, newText.trim());
        }
      },
      text: 'Edit',
    })
  );
  popup.appendChild(
    el('button', {
      class: 'text-button',
      style: 'text-align:left;padding:6px 8px;color:var(--danger);',
      onclick: () => {
        popup.remove();
        if (confirm('Unsend this message for everyone?')) onUnsendMessage(message.id);
      },
      text: 'Unsend',
    })
  );
  document.body.appendChild(popup);
  setTimeout(() => {
    document.addEventListener('click', function handler() {
      popup.remove();
      document.removeEventListener('click', handler);
    });
  }, 0);
}

function openReactionPicker(anchorEl, message, onReact) {
  closeAnyOpenReactionPicker();
  const rect = anchorEl.getBoundingClientRect();
  const popup = el('div', {
    class: 'reaction-picker-popup',
    style: `position:fixed;top:${rect.top - 44}px;left:${rect.left}px;background:var(--panel-bg);border:1px solid var(--border);border-radius:16px;padding:6px 8px;display:flex;gap:6px;z-index:100;`,
  });
  for (const emoji of QUICK_REACTIONS) {
    popup.appendChild(
      el('button', {
        style: 'background:none;border:none;font-size:18px;cursor:pointer;',
        onclick: () => {
          onReact(message.id, emoji);
          popup.remove();
        },
        text: emoji,
      })
    );
  }
  document.body.appendChild(popup);
  setTimeout(() => {
    document.addEventListener('click', function handler() {
      popup.remove();
      document.removeEventListener('click', handler);
    });
  }, 0);
}
