import { getSession, onAuthStateChange, requestMagicLink, isLocalUnlockEnrolled, verifyLocalUnlock, signOut } from './auth.js';
import { hasLocalIdentity, loadIdentity, importBackup, generateIdentity } from './crypto/keys.js';
import { getCachedConversationKey, resolveConversationKey } from './crypto/conversationKeys.js';
import { getMyProfile, getAllProfiles } from './db/profiles.js';
import {
  listMyConversations,
  getConversationMembers,
  getMyWrappedKey,
  createConversation,
  renameConversation,
  updateConversationPhoto,
} from './db/conversations.js';
import {
  fetchMessages,
  fetchLatestMessage,
  decryptMessageRow,
  sendMessage,
  sendAttachmentMessage,
  fetchReactions,
  addReaction,
  removeReaction,
} from './db/messages.js';
import { uploadEncryptedAttachment, downloadEncryptedAttachment, uploadGroupPhoto } from './db/storage.js';
import { startRealtime } from './realtime.js';
import { sb } from './supabaseClient.js';
import { renderOnboarding } from './ui/onboarding.js';
import { renderConversationList } from './ui/conversationList.js';
import { renderThreadView } from './ui/threadView.js';
import { renderGroupInfoSheet } from './ui/groupInfoSheet.js';
import { renderProfileSettings } from './ui/profileSettings.js';
import { renderNewConversationModal } from './ui/newConversationModal.js';
import { el, clear } from './ui/dom.js';

const appRoot = document.getElementById('app');

const state = {
  user: null,
  identity: null,
  myProfile: null,
  profilesById: new Map(),
  conversations: [],
  activeConversationId: null,
  messagesByConversation: new Map(),
  reactionsByMessageId: new Map(),
  replyTarget: null,
  stopRealtime: null,
};

// Persistent layout nodes, created once on entering the main app, so a modal
// (group info, profile settings) never gets wiped out by an unrelated
// background refresh re-rendering the sidebar/thread.
let layoutEl = null;
let sidebarEl = null;
let threadPaneEl = null;
let modalRootEl = null;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Offline shell just won't be available this session — not fatal.
  });
}

boot();

async function boot() {
  const session = await getSession();
  if (!session) {
    renderLoginScreen();
    onAuthStateChange((event, newSession) => {
      // Simplest correct handling of the magic-link redirect: reload once
      // signed in so every module re-initializes against the real session.
      if (event === 'SIGNED_IN' && newSession) location.reload();
    });
    return;
  }
  state.user = session.user;
  await enterApp();
}

function renderLoginScreen() {
  clear(appRoot);
  const emailInput = el('input', { class: 'text-input', type: 'email', placeholder: 'you@example.com' });
  const statusEl = el('p', {});
  appRoot.appendChild(
    el('div', { class: 'centered-screen' }, [
      el('h1', { text: 'Goyfriends' }),
      el('p', { text: "Enter the email you were invited with, and we'll send you a sign-in link." }),
      emailInput,
      el('button', {
        class: 'primary-button',
        onclick: async () => {
          const email = emailInput.value.trim();
          if (!email) return;
          statusEl.textContent = 'Sending…';
          try {
            await requestMagicLink(email);
            statusEl.textContent = 'Check your email for a sign-in link.';
          } catch (err) {
            statusEl.textContent = 'Error: ' + err.message;
          }
        },
        text: 'Send sign-in link',
      }),
      statusEl,
    ])
  );
}

async function enterApp() {
  const profile = await getMyProfile(state.user.id);
  if (!profile) {
    clear(appRoot);
    renderOnboarding(appRoot, { user: state.user, onComplete: enterApp });
    return;
  }
  state.myProfile = profile;

  const identityExists = await hasLocalIdentity(state.user.id);
  if (!identityExists) {
    renderNoLocalIdentityScreen();
    return;
  }

  if (isLocalUnlockEnrolled()) {
    renderLockScreen();
    return;
  }

  await proceedIntoApp();
}

async function proceedIntoApp() {
  state.identity = await loadIdentity(state.user.id);
  initMainLayout();
  await refreshConversationList();
}

function renderLockScreen() {
  clear(appRoot);
  const statusEl = el('p', {});
  const attempt = async () => {
    statusEl.textContent = '';
    const ok = await verifyLocalUnlock();
    if (ok) {
      await proceedIntoApp();
    } else {
      statusEl.textContent = 'Unlock failed or was cancelled.';
    }
  };
  appRoot.appendChild(
    el('div', { class: 'lock-screen' }, [
      el('h1', { text: 'Goyfriends is locked' }),
      el('button', { class: 'primary-button', onclick: attempt, text: 'Unlock' }),
      statusEl,
      el('button', {
        class: 'text-button',
        onclick: async () => {
          await signOut();
          location.reload();
        },
        text: 'Trouble unlocking? Sign out and sign in again',
      }),
    ])
  );
  attempt();
}

// New device (or cleared browser storage) with no local key material yet.
function renderNoLocalIdentityScreen() {
  clear(appRoot);
  const fileInput = el('input', { type: 'file', accept: '.json' });
  const passInput = el('input', { class: 'text-input', type: 'password', placeholder: 'Backup passphrase' });
  const statusEl = el('p', {});

  appRoot.appendChild(
    el('div', { class: 'centered-screen' }, [
      el('h1', { text: 'New device' }),
      el('p', { text: 'This device has no message key yet. If you exported a backup before, restore it below to read your old messages.' }),
      fileInput,
      passInput,
      el('button', {
        class: 'primary-button',
        onclick: async () => {
          const file = fileInput.files[0];
          if (!file) {
            statusEl.textContent = 'Choose a backup file first.';
            return;
          }
          try {
            const backup = JSON.parse(await file.text());
            await importBackup(state.user.id, backup, passInput.value);
            await enterApp();
          } catch (err) {
            statusEl.textContent = 'Error: ' + err.message;
          }
        },
        text: 'Restore from backup',
      }),
      statusEl,
      el('p', {
        class: 'security-note',
        text: "No backup? Starting fresh generates a new key for this device. You won't be able to read old messages unless a friend re-shares them with your new key — old history can't be recovered by anyone, including Kent.",
      }),
      el('button', {
        class: 'secondary-button',
        onclick: async () => {
          const { publicKeyB64 } = await generateIdentity(state.user.id);
          // Publish the new public key so future conversations can wrap keys to it.
          await sb.from('profiles').update({ public_key: publicKeyB64 }).eq('id', state.user.id);
          await enterApp();
        },
        text: "I don't have a backup — start fresh",
      }),
    ])
  );
}

function initMainLayout() {
  clear(appRoot);
  layoutEl = el('div', { class: 'main-layout' });
  sidebarEl = el('div', { class: 'sidebar' });
  threadPaneEl = el('div', { class: 'thread-pane' });
  layoutEl.appendChild(sidebarEl);
  layoutEl.appendChild(threadPaneEl);
  modalRootEl = el('div');
  appRoot.appendChild(layoutEl);
  appRoot.appendChild(modalRootEl);

  if (state.stopRealtime) state.stopRealtime();
  state.stopRealtime = startRealtime({
    onMessageInsert: () => {
      refreshConversationList();
      refreshActiveThread();
    },
    onReactionChange: () => refreshActiveThread(),
    onResync: () => {
      refreshConversationList();
      refreshActiveThread();
    },
  });
}

function renderAll() {
  layoutEl.classList.toggle('showing-thread', !!state.activeConversationId);

  renderConversationList(sidebarEl, {
    conversations: state.conversations,
    activeConversationId: state.activeConversationId,
    myUserId: state.user.id,
    onSelect: openConversation,
    onNewConversation: openNewConversationModal,
    onOpenProfileSettings: openProfileSettings,
  });

  const activeConversation = state.conversations.find((c) => c.id === state.activeConversationId) || null;
  renderThreadView(threadPaneEl, {
    conversation: activeConversation,
    myUserId: state.user.id,
    messages: state.messagesByConversation.get(state.activeConversationId) || [],
    reactionsByMessageId: state.reactionsByMessageId,
    profilesById: state.profilesById,
    onBack: () => {
      state.activeConversationId = null;
      renderAll();
    },
    onOpenGroupInfo: () => activeConversation && openGroupInfo(activeConversation),
    onSendText: sendTextMessage,
    onSendFile: sendFileMessage,
    replyTarget: state.replyTarget,
    onSetReplyTarget: (target) => {
      state.replyTarget = target;
      renderAll();
    },
    onCancelReply: () => {
      state.replyTarget = null;
      renderAll();
    },
    onReact: reactToMessage,
    getAttachmentUrl,
  });
}

async function refreshConversationList() {
  const rawConversations = await listMyConversations();
  const enriched = [];
  for (const conversation of rawConversations) {
    const members = await getConversationMembers(conversation.id);
    for (const member of members) state.profilesById.set(member.id, member);

    let symKey = getCachedConversationKey(conversation.id);
    if (!symKey) {
      const wrapped = await getMyWrappedKey(conversation.id);
      if (wrapped) symKey = await resolveConversationKey(conversation.id, wrapped, state.identity);
    }

    let previewText = 'No messages yet';
    if (symKey) {
      try {
        const latest = await fetchLatestMessage(conversation.id);
        if (latest) {
          const decrypted = await decryptMessageRow(latest, symKey);
          previewText = decrypted.attachmentMeta ? `📎 ${decrypted.attachmentMeta.name}` : decrypted.body;
        }
      } catch {
        previewText = '(unable to decrypt)';
      }
    }

    enriched.push({ ...conversation, membersProfiles: members, previewText });
  }
  enriched.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  state.conversations = enriched;

  if (!state.profilesById.has(state.myProfile.id)) state.profilesById.set(state.myProfile.id, state.myProfile);
  const everyone = await getAllProfiles();
  for (const profile of everyone) state.profilesById.set(profile.id, profile);

  renderAll();
}

async function refreshActiveThread() {
  if (!state.activeConversationId) return;
  const symKey = getCachedConversationKey(state.activeConversationId);
  if (!symKey) return;

  const rows = await fetchMessages(state.activeConversationId);
  const decrypted = await Promise.all(
    rows.map(async (row) => {
      try {
        return await decryptMessageRow(row, symKey);
      } catch {
        return { ...row, body: '', attachmentMeta: null, decryptFailed: true };
      }
    })
  );
  state.messagesByConversation.set(state.activeConversationId, decrypted);

  const reactions = await fetchReactions(decrypted.map((m) => m.id));
  const grouped = new Map();
  for (const reaction of reactions) {
    if (!grouped.has(reaction.message_id)) grouped.set(reaction.message_id, []);
    grouped.get(reaction.message_id).push(reaction);
  }
  state.reactionsByMessageId = grouped;

  renderAll();
}

async function openConversation(conversationId) {
  state.activeConversationId = conversationId;
  state.replyTarget = null;
  renderAll();
  await refreshActiveThread();
}

async function sendTextMessage(text, replyTo) {
  const conversationId = state.activeConversationId;
  const symKey = getCachedConversationKey(conversationId);
  if (!symKey) return;
  state.replyTarget = null;
  await sendMessage({ conversationId, senderId: state.user.id, symKey, plaintext: text, replyTo });
  await refreshActiveThread();
  await refreshConversationList();
}

async function sendFileMessage(file, replyTo) {
  const conversationId = state.activeConversationId;
  const symKey = getCachedConversationKey(conversationId);
  if (!symKey) return;
  state.replyTarget = null;
  const attachment = await uploadEncryptedAttachment(conversationId, file, symKey);
  await sendAttachmentMessage({ conversationId, senderId: state.user.id, symKey, caption: '', attachment, replyTo });
  await refreshActiveThread();
  await refreshConversationList();
}

async function getAttachmentUrl(message) {
  const symKey = getCachedConversationKey(message.conversation_id);
  if (!symKey) return null;
  const blob = await downloadEncryptedAttachment(message.attachment_path, symKey, message.attachmentMeta?.type);
  return URL.createObjectURL(blob);
}

async function reactToMessage(messageId, emoji) {
  const existing = (state.reactionsByMessageId.get(messageId) || []).find(
    (r) => r.user_id === state.user.id && r.emoji === emoji
  );
  if (existing) await removeReaction(messageId, state.user.id, emoji);
  else await addReaction(messageId, state.user.id, emoji);
  await refreshActiveThread();
}

function openNewConversationModal() {
  const otherProfiles = Array.from(state.profilesById.values()).filter((p) => p.id !== state.user.id);
  renderNewConversationModal(modalRootEl, {
    otherProfiles,
    myUserId: state.user.id,
    onCreate: async ({ memberUserIds, title, isGroup }) => {
      await createConversation({ title, isGroup, creatorId: state.user.id, memberUserIds });
      await refreshConversationList();
    },
    onClose: () => {},
  });
}

function openGroupInfo(conversation) {
  renderGroupInfoSheet(modalRootEl, {
    conversation,
    membersProfiles: conversation.membersProfiles,
    myUserId: state.user.id,
    onClose: () => {},
    onRename: async (title) => {
      await renameConversation(conversation.id, title);
      await refreshConversationList();
    },
    onChangePhoto: async (file) => {
      const path = await uploadGroupPhoto(conversation.id, file);
      await updateConversationPhoto(conversation.id, path);
      await refreshConversationList();
    },
    onLeave: async () => {
      await sb
        .from('conversation_members')
        .delete()
        .eq('conversation_id', conversation.id)
        .eq('user_id', state.user.id);
      state.activeConversationId = null;
      await refreshConversationList();
    },
  });
}

function openProfileSettings() {
  renderProfileSettings(modalRootEl, {
    user: state.user,
    myProfile: state.myProfile,
    onClose: () => {},
    onProfileUpdated: (updated) => {
      state.myProfile = updated;
      state.profilesById.set(updated.id, updated);
      renderAll();
    },
    onSignedOut: () => location.reload(),
  });
}
