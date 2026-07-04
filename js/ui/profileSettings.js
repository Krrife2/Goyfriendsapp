import { el, clear } from './dom.js';
import { renderAvatar, invalidateAvatarCache } from './avatar.js';
import { updateMyProfile } from '../db/profiles.js';
import { uploadUserAvatar } from '../db/storage.js';
import { exportBackup, importBackup } from '../crypto/keys.js';
import {
  isWebAuthnAvailable,
  isLocalUnlockEnrolled,
  enrollLocalUnlock,
  disableLocalUnlock,
  signOut,
} from '../auth.js';

export function renderProfileSettings(modalRoot, ctx) {
  const { user, myProfile, onClose, onProfileUpdated, onSignedOut } = ctx;
  clear(modalRoot);

  let pendingAvatarFile = null;
  const avatarPreview = renderAvatar(myProfile.avatar_path, myProfile.display_name, '');
  const avatarInput = el('input', {
    type: 'file',
    accept: 'image/*',
    style: 'display:none',
    onchange: (e) => {
      pendingAvatarFile = e.target.files[0] || null;
      if (pendingAvatarFile) {
        clear(avatarPreview);
        avatarPreview.appendChild(el('img', { src: URL.createObjectURL(pendingAvatarFile) }));
      }
    },
  });
  const nameInput = el('input', { class: 'text-input', type: 'text', value: myProfile.display_name || '' });
  const saveStatus = el('span', { class: 'field-label' });

  const backupPassInput = el('input', { class: 'text-input', type: 'password', placeholder: 'Backup passphrase' });
  const backupStatus = el('span', { class: 'field-label' });

  const importFileInput = el('input', { type: 'file', accept: '.json', style: 'display:none' });
  const importPassInput = el('input', { class: 'text-input', type: 'password', placeholder: 'Backup passphrase' });
  const importStatus = el('span', { class: 'field-label' });

  const unlockStatus = el('span', {
    class: 'field-label',
    text: isLocalUnlockEnrolled() ? 'Quick unlock is on for this device' : 'Quick unlock is off',
  });

  const backdrop = el(
    'div',
    { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } },
    [
      el('div', { class: 'modal-sheet' }, [
        el('h3', { text: 'Your profile' }),
        el('div', { class: 'avatar-picker' }, [
          avatarPreview,
          el('button', { class: 'text-button', onclick: () => avatarInput.click(), text: 'Change photo' }),
          avatarInput,
        ]),
        nameInput,
        el('button', {
          class: 'secondary-button',
          onclick: async () => {
            saveStatus.textContent = 'Saving…';
            try {
              let avatarPath = myProfile.avatar_path;
              if (pendingAvatarFile) avatarPath = await uploadUserAvatar(user.id, pendingAvatarFile);
              const updated = await updateMyProfile(user.id, { displayName: nameInput.value.trim(), avatarPath });
              if (pendingAvatarFile) invalidateAvatarCache(avatarPath);
              saveStatus.textContent = 'Saved.';
              onProfileUpdated(updated);
            } catch (err) {
              saveStatus.textContent = 'Error: ' + err.message;
            }
          },
          text: 'Save profile',
        }),
        saveStatus,

        el('hr', { style: 'border-color:var(--border);width:100%' }),
        el('span', { class: 'field-label', text: 'Key backup' }),
        el('p', {
          class: 'security-note',
          text: 'Your message key lives only on this device. Back it up so you can recover message history if you switch devices — nobody else, including Kent, can do this for you.',
        }),
        backupPassInput,
        el('button', {
          class: 'secondary-button',
          onclick: async () => {
            if (!backupPassInput.value || backupPassInput.value.length < 6) {
              backupStatus.textContent = 'Use a passphrase of at least 6 characters.';
              return;
            }
            const backup = await exportBackup(user.id, backupPassInput.value);
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = el('a', { href: url, download: `goyfriends-backup-${user.email}.json` });
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            backupStatus.textContent = 'Backup downloaded.';
          },
          text: 'Download backup',
        }),
        backupStatus,

        el('span', { class: 'field-label', text: 'Restore from backup (new device)' }),
        el('div', { style: 'display:flex;gap:8px' }, [
          el('button', { class: 'secondary-button', onclick: () => importFileInput.click(), text: 'Choose file' }),
          importFileInput,
        ]),
        importPassInput,
        el('button', {
          class: 'secondary-button',
          onclick: async () => {
            const file = importFileInput.files[0];
            if (!file) {
              importStatus.textContent = 'Choose a backup file first.';
              return;
            }
            try {
              const backup = JSON.parse(await file.text());
              await importBackup(user.id, backup, importPassInput.value);
              importStatus.textContent = 'Restored. Reload the app to use it.';
            } catch (err) {
              importStatus.textContent = 'Error: ' + err.message;
            }
          },
          text: 'Restore',
        }),
        importStatus,

        el('hr', { style: 'border-color:var(--border);width:100%' }),
        el('span', { class: 'field-label', text: 'Quick unlock' }),
        unlockStatus,
        isWebAuthnAvailable()
          ? el('button', {
              class: 'secondary-button',
              onclick: async () => {
                if (isLocalUnlockEnrolled()) {
                  disableLocalUnlock();
                } else {
                  try {
                    await enrollLocalUnlock(user.id, user.email);
                  } catch {
                    return;
                  }
                }
                unlockStatus.textContent = isLocalUnlockEnrolled() ? 'Quick unlock is on for this device' : 'Quick unlock is off';
              },
              text: isLocalUnlockEnrolled() ? 'Turn off quick unlock' : 'Turn on quick unlock',
            })
          : null,

        el('div', { class: 'modal-actions' }, [
          el('button', {
            class: 'secondary-button',
            onclick: async () => {
              await signOut();
              close();
              onSignedOut();
            },
            text: 'Sign out',
          }),
          el('button', { class: 'primary-button', onclick: close, text: 'Done' }),
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
