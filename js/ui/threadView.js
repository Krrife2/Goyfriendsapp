import { el, clear, formatTime } from './dom.js';
import { renderAvatar } from './avatar.js';
import { renderComposer } from './composer.js';
import { displayTitleFor, avatarPathFor } from './conversationList.js';

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
    profilesById,
    onBack,
    onOpenGroupInfo,
    onSendText,
    onSendFile,
    replyTarget,
    onSetReplyTarget,
    onCancelReply,
    onReact,
    getAttachmentUrl,
  } = ctx;

  clear(container);

  if (!conversation) {
    container.appendChild(el('div', { class: 'thread-empty', text: 'Select a conversation, or start a new one.' }));
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

    if (message.decryptFailed) {
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
    }

    bubble.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      openReactionPicker(bubble, message, onReact);
    });
    row.appendChild(bubble);

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

    row.appendChild(el('div', { class: 'bubble-timestamp', text: formatTime(message.created_at) }));

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      onSetReplyTarget({ id: message.id, previewText: message.decryptFailed ? '(undecryptable)' : message.body });
    });

    listEl.appendChild(row);
  }

  listEl.scrollTop = listEl.scrollHeight;

  const composerContainer = el('div');
  container.appendChild(composerContainer);
  renderComposer(composerContainer, {
    replyTarget,
    onCancelReply,
    onSendText: (text) => onSendText(text, replyTarget?.id || null),
    onSendFile: (file) => onSendFile(file, replyTarget?.id || null),
  });
}

function renderAttachment(message, getAttachmentUrl) {
  const meta = message.attachmentMeta || { name: 'file', type: '' };
  const isImage = meta.type && meta.type.startsWith('image/');

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
