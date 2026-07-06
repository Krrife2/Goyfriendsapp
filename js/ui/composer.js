import { el, clear } from './dom.js';
import { isVoiceRecordingSupported, createRecorder } from '../voice.js';

const HOLD_FOR_EFFECTS_MS = 450;

// Pure UI: captures text/attachment/voice input and hands off to callbacks.
// The caller (app.js) owns encryption/upload/db-insert, since it holds the
// conversation's symmetric key and sender id.
export function renderComposer(container, ctx) {
  const { replyTarget, onSendText, onSendFile, onSendVoice, onOpenEffectPicker, onCancelReply, onTyping } = ctx;
  clear(container);

  if (replyTarget) {
    container.appendChild(
      el('div', { class: 'composer-reply-preview' }, [
        el('span', { text: `Replying to: ${replyTarget.previewText || ''}` }),
        el('button', { class: 'text-button', onclick: onCancelReply, text: 'Cancel' }),
      ])
    );
  }

  const textarea = el('textarea', {
    class: 'composer-input',
    placeholder: 'Ribbit…',
    rows: '1',
    oninput: () => {
      const hasText = textarea.value.length > 0;
      onTyping && onTyping(hasText);
      rightSlot.textContent = '';
      rightSlot.appendChild(hasText ? sendButton : micButton);
    },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitText();
      }
    },
  });

  const fileInput = el('input', {
    type: 'file',
    style: 'display:none',
    onchange: (e) => {
      const file = e.target.files[0];
      if (file) onSendFile(file);
      fileInput.value = '';
    },
  });

  function submitText() {
    const text = textarea.value.trim();
    if (!text) return;
    onSendText(text);
    textarea.value = '';
    onTyping && onTyping(false);
    rightSlot.textContent = '';
    rightSlot.appendChild(micButton);
  }

  // Tap = send. Press-and-hold = open the effect picker instead (iMessage's
  // "send with effect" gesture), so the everyday tap-to-send stays a single action.
  let holdTimer = null;
  let effectsOpened = false;
  const sendButton = el('button', {
    class: 'send-button',
    title: 'Send (hold for effects)',
    text: '↑',
    onpointerdown: () => {
      effectsOpened = false;
      holdTimer = setTimeout(() => {
        effectsOpened = true;
        const text = textarea.value.trim();
        if (text && onOpenEffectPicker) {
          onOpenEffectPicker(text, replyTarget?.id || null, () => {
            textarea.value = '';
            onTyping && onTyping(false);
            rightSlot.textContent = '';
            rightSlot.appendChild(micButton);
          });
        }
      }, HOLD_FOR_EFFECTS_MS);
    },
    onpointerup: () => {
      clearTimeout(holdTimer);
      if (!effectsOpened) submitText();
    },
    onpointerleave: () => clearTimeout(holdTimer),
  });

  // Hold-to-record, like iMessage's mic button. Releasing sends the clip;
  // dragging away/leaving cancels it without sending.
  const recorder = isVoiceRecordingSupported() ? createRecorder() : null;
  let recording = false;
  const micButton = el('button', {
    class: 'icon-button',
    title: recorder ? 'Hold to record a voice message' : 'Voice messages not supported on this browser',
    text: '🎤',
    onpointerdown: async () => {
      if (!recorder || recording) return;
      recording = true;
      micButton.classList.add('recording');
      try {
        await recorder.start();
      } catch {
        recording = false;
        micButton.classList.remove('recording');
      }
    },
    onpointerup: async () => {
      if (!recorder || !recording) return;
      recording = false;
      micButton.classList.remove('recording');
      const result = await recorder.stop();
      if (result) onSendVoice && onSendVoice(result.blob, result.durationMs, replyTarget?.id || null);
    },
    onpointerleave: () => {
      if (!recorder || !recording) return;
      recording = false;
      micButton.classList.remove('recording');
      recorder.cancel();
    },
  });

  const rightSlot = el('div', { class: 'composer-right-slot' }, [micButton]);

  const bar = el('div', { class: 'composer-bar' }, [
    el('button', { class: 'icon-button', title: 'Attach a file', onclick: () => fileInput.click(), text: '📎' }),
    fileInput,
    textarea,
    rightSlot,
  ]);
  container.appendChild(bar);
}
