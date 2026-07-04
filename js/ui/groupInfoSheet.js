import { el, clear } from './dom.js';
import { renderAvatar, invalidateAvatarCache } from './avatar.js';

// Renders into a modal root and returns a close() function.
export function renderGroupInfoSheet(modalRoot, ctx) {
  const { conversation, membersProfiles, myUserId, onClose, onRename, onChangePhoto, onLeave } = ctx;
  clear(modalRoot);

  const photoPreview = renderAvatar(conversation.photo_path, conversation.title || 'Group', '');
  const photoInput = el('input', {
    type: 'file',
    accept: 'image/*',
    style: 'display:none',
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await onChangePhoto(file);
      invalidateAvatarCache(conversation.photo_path);
    },
  });

  const titleInput = el('input', {
    class: 'text-input',
    type: 'text',
    value: conversation.title || '',
    placeholder: 'Group name',
  });

  const memberRows = membersProfiles.map((profile) =>
    el('div', { class: 'member-row' }, [
      renderAvatar(profile.avatar_path, profile.display_name, 'tiny'),
      el('span', { class: 'name', text: profile.display_name + (profile.id === myUserId ? ' (you)' : '') }),
    ])
  );

  const backdrop = el(
    'div',
    { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } },
    [
      el('div', { class: 'modal-sheet' }, [
        el('h3', { text: 'Conversation info' }),
        el('div', { class: 'avatar-picker' }, [
          photoPreview,
          conversation.is_group
            ? el('button', { class: 'text-button', onclick: () => photoInput.click(), text: 'Change group photo' })
            : null,
          photoInput,
        ]),
        conversation.is_group
          ? el('div', {}, [
              el('span', { class: 'field-label', text: 'Group name' }),
              titleInput,
            ])
          : null,
        el('span', { class: 'field-label', text: 'Members' }),
        el('div', {}, memberRows),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'secondary-button', onclick: onLeave, text: 'Leave conversation' }),
          conversation.is_group
            ? el('button', {
                class: 'primary-button',
                onclick: async () => {
                  await onRename(titleInput.value.trim());
                  close();
                },
                text: 'Save',
              })
            : el('button', { class: 'secondary-button', onclick: close, text: 'Close' }),
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
