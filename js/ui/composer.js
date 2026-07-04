import { el, clear } from './dom.js';

// Pure UI: captures text/attachment input and hands off to callbacks. The
// caller (app.js) owns encryption/upload/db-insert, since it holds the
// conversation's symmetric key and sender id.
export function renderComposer(container, ctx) {
  const { replyTarget, onSendText, onSendFile, onCancelReply, onTyping } = ctx;
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
    oninput: () => onTyping && onTyping(textarea.value.length > 0),
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
  }

  const bar = el('div', { class: 'composer-bar' }, [
    el('button', { class: 'icon-button', title: 'Attach a file', onclick: () => fileInput.click(), text: '📎' }),
    fileInput,
    textarea,
    el('button', { class: 'icon-button', title: 'Send', onclick: submitText, text: '➤' }),
  ]);
  container.appendChild(bar);
}
