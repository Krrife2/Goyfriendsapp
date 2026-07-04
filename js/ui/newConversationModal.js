import { el, clear } from './dom.js';
import { renderAvatar } from './avatar.js';

export function renderNewConversationModal(modalRoot, ctx) {
  const { otherProfiles, myUserId, onCreate, onClose } = ctx;
  clear(modalRoot);

  const selected = new Set();
  const titleInput = el('input', { class: 'text-input', type: 'text', placeholder: 'Group name (optional)' });
  const statusEl = el('span', { class: 'field-label' });

  const memberRows = otherProfiles.map((profile) => {
    const checkbox = el('input', { type: 'checkbox', onchange: (e) => {
      if (e.target.checked) selected.add(profile.id);
      else selected.delete(profile.id);
    } });
    return el('div', { class: 'member-row' }, [
      checkbox,
      renderAvatar(profile.avatar_path, profile.display_name, 'tiny'),
      el('span', { class: 'name', text: profile.display_name }),
    ]);
  });

  const backdrop = el(
    'div',
    { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } },
    [
      el('div', { class: 'modal-sheet' }, [
        el('h3', { text: 'New conversation' }),
        el('span', { class: 'field-label', text: 'Choose who to include' }),
        el('div', {}, memberRows),
        titleInput,
        statusEl,
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'secondary-button', onclick: close, text: 'Cancel' }),
          el('button', {
            class: 'primary-button',
            onclick: async () => {
              if (selected.size === 0) {
                statusEl.textContent = 'Pick at least one person.';
                return;
              }
              const memberUserIds = [myUserId, ...selected];
              const isGroup = selected.size > 1;
              statusEl.textContent = 'Creating…';
              try {
                await onCreate({ memberUserIds, title: titleInput.value.trim() || null, isGroup });
                close();
              } catch (err) {
                statusEl.textContent = 'Error: ' + err.message;
              }
            },
            text: 'Create',
          }),
        ]),
      ]),
    ]
  );

  function close() {
    clear(modalRoot);
    onClose && onClose();
  }

  modalRoot.appendChild(backdrop);
  return close;
}
