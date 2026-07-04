import { el, clear, formatShortTime } from './dom.js';
import { renderAvatar } from './avatar.js';

function displayTitleFor(conversation, myUserId) {
  if (conversation.title) return conversation.title;
  const others = (conversation.membersProfiles || []).filter((p) => p.id !== myUserId);
  if (others.length === 0) return 'Just you';
  return others.map((p) => p.display_name || 'Unnamed').join(', ');
}

function avatarPathFor(conversation, myUserId) {
  if (conversation.photo_path) return conversation.photo_path;
  const others = (conversation.membersProfiles || []).filter((p) => p.id !== myUserId);
  return others[0]?.avatar_path || null;
}

export function renderConversationList(container, ctx) {
  const { conversations, activeConversationId, myUserId, onSelect, onNewConversation, onOpenProfileSettings } = ctx;
  clear(container);

  const header = el('div', { class: 'sidebar-header' }, [
    el('h2', { text: 'Goyfriends 🐸' }),
    el('div', { style: 'display:flex;gap:8px' }, [
      el('button', { class: 'icon-button', title: 'Profile & settings', onclick: onOpenProfileSettings, text: '⚙' }),
      el('button', { class: 'icon-button', title: 'New conversation', onclick: onNewConversation, text: '+' }),
    ]),
  ]);
  container.appendChild(header);

  const listEl = el('div', { class: 'conversation-list' });
  if (conversations.length === 0) {
    listEl.appendChild(el('div', { style: 'padding:20px;color:var(--text-dim);font-size:13px', text: 'No ripples yet 🐸 — start one with the + button.' }));
  }
  for (const conversation of conversations) {
    const title = displayTitleFor(conversation, myUserId);
    const avatarPath = avatarPathFor(conversation, myUserId);
    const item = el(
      'div',
      {
        class: `conversation-item${conversation.id === activeConversationId ? ' active' : ''}`,
        onclick: () => onSelect(conversation.id),
      },
      [
        renderAvatar(avatarPath, title, 'small'),
        el('div', { class: 'conversation-meta' }, [
          el('div', { class: 'conversation-title' }, [
            conversation.pinned_at ? el('span', { text: '📌 ' }) : null,
            title,
            conversation.muted ? el('span', { text: ' 🔇' }) : null,
          ]),
          el('div', { class: 'conversation-preview', text: conversation.previewText || 'No messages yet' }),
        ]),
        el('div', { class: 'conversation-time', text: conversation.updated_at ? formatShortTime(conversation.updated_at) : '' }),
      ]
    );
    listEl.appendChild(item);
  }
  container.appendChild(listEl);
}

export { displayTitleFor, avatarPathFor };
