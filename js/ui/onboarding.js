import { el, clear } from './dom.js';
import { generateIdentity, exportBackup } from '../crypto/keys.js';
import { createMyProfile } from '../db/profiles.js';
import { uploadUserAvatar } from '../db/storage.js';
import { enrollLocalUnlock, isWebAuthnAvailable } from '../auth.js';

// First-login setup wizard: profile (name/avatar) -> key generation ->
// optional key backup -> optional WebAuthn local unlock -> done.
export function renderOnboarding(container, { user, onComplete }) {
  let step = 'profile';
  let pendingAvatarFile = null;
  let profileError = null;

  function render() {
    clear(container);
    if (step === 'profile') container.appendChild(renderProfileStep());
    else if (step === 'working') container.appendChild(renderWorkingStep());
    else if (step === 'backup') container.appendChild(renderBackupStep());
    else if (step === 'unlock') container.appendChild(renderUnlockStep());
  }

  function renderProfileStep() {
    const avatarPreview = el('div', { class: 'avatar-circle' }, '📷');
    const fileInput = el('input', {
      type: 'file',
      accept: 'image/*',
      style: 'display:none',
      onchange: (e) => {
        const file = e.target.files[0];
        if (!file) return;
        pendingAvatarFile = file;
        clear(avatarPreview);
        avatarPreview.appendChild(el('img', { src: URL.createObjectURL(file) }));
      },
    });
    const nameInput = el('input', {
      class: 'text-input',
      type: 'text',
      placeholder: 'Your name',
      autofocus: true,
    });
    return el('div', { class: 'centered-screen' }, [
      el('h1', { text: 'Welcome to Goyfriends' }),
      el('p', { text: 'Set up your profile. This name and photo are visible to the group — they are not encrypted, same as any messaging app.' }),
      el('div', { class: 'avatar-picker' }, [
        avatarPreview,
        el('button', { class: 'text-button', onclick: () => fileInput.click(), text: 'Choose a photo' }),
        fileInput,
      ]),
      nameInput,
      profileError ? el('p', { style: 'color:var(--danger)', text: profileError }) : null,
      el('button', {
        class: 'primary-button',
        onclick: async () => {
          const displayName = nameInput.value.trim();
          if (!displayName) {
            profileError = 'Please enter a name.';
            render();
            return;
          }
          step = 'working';
          render();
          try {
            let avatarPath = null;
            if (pendingAvatarFile) avatarPath = await uploadUserAvatar(user.id, pendingAvatarFile);
            const { publicKeyB64 } = await generateIdentity(user.id);
            await createMyProfile({
              id: user.id,
              displayName,
              avatarPath,
              publicKeyB64,
            });
            step = 'backup';
            render();
          } catch (err) {
            profileError = 'Something went wrong: ' + err.message;
            step = 'profile';
            render();
          }
        },
        text: 'Continue',
      }),
    ]);
  }

  function renderWorkingStep() {
    return el('div', { class: 'centered-screen' }, [
      el('h1', { text: 'Setting up your encryption keys…' }),
      el('p', { text: 'This only happens once on this device.' }),
    ]);
  }

  function renderBackupStep() {
    const passInput = el('input', { class: 'text-input', type: 'password', placeholder: 'Choose a backup passphrase' });
    const statusEl = el('p', {});

    return el('div', { class: 'centered-screen' }, [
      el('h1', { text: 'Back up your key' }),
      el('p', {
        text: 'Your messages are encrypted with a key that only lives on this device. If you lose this device without a backup, you permanently lose access to your old messages — nobody, including Kent, can recover them. Strongly recommended: back it up now.',
      }),
      passInput,
      el('button', {
        class: 'primary-button',
        onclick: async () => {
          const passphrase = passInput.value;
          if (!passphrase || passphrase.length < 6) {
            statusEl.textContent = 'Use a passphrase of at least 6 characters.';
            return;
          }
          const backup = await exportBackup(user.id, passphrase);
          const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = el('a', { href: url, download: `goyfriends-backup-${user.email}.json` });
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          step = 'unlock';
          render();
        },
        text: 'Download backup file',
      }),
      statusEl,
      el('button', { class: 'text-button', onclick: () => { step = 'unlock'; render(); }, text: "Skip for now (I'll do this later)" }),
    ]);
  }

  function renderUnlockStep() {
    if (!isWebAuthnAvailable()) {
      onComplete();
      return el('div');
    }
    return el('div', { class: 'centered-screen' }, [
      el('h1', { text: 'Enable quick unlock' }),
      el('p', { text: 'Use Face ID, Touch ID, or Windows Hello to reopen Goyfriends quickly. This is just a local convenience lock on this device — your account login stays with your email.' }),
      el('button', {
        class: 'primary-button',
        onclick: async () => {
          try {
            await enrollLocalUnlock(user.id, user.email);
          } catch {
            // user cancelled or platform authenticator unavailable — fine, just continue
          }
          onComplete();
        },
        text: 'Enable quick unlock',
      }),
      el('button', { class: 'text-button', onclick: onComplete, text: 'Skip' }),
    ]);
  }

  render();
}
