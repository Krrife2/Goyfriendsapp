import { el, clear } from './dom.js';
import { BUBBLE_EFFECTS, SCREEN_EFFECTS } from '../effects.js';

const LABELS = {
  slam: '💥 Slam',
  loud: '📢 Loud',
  gentle: '🍃 Gentle',
  'invisible-ink': '🫥 Invisible Ink',
  balloons: '🎈 Balloons',
  confetti: '🎊 Confetti',
  love: '❤️ Love',
};

// Long-press on the send button (iMessage's "send with effect" gesture)
// opens this. Picking an effect sends immediately with that effect attached.
export function renderEffectPicker(modalRoot, { text, onPick, onClose }) {
  clear(modalRoot);

  function option(effectName) {
    return el('button', {
      class: 'effect-picker-option',
      onclick: () => {
        onPick(effectName);
        close();
      },
      text: LABELS[effectName] || effectName,
    });
  }

  const backdrop = el(
    'div',
    { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } },
    [
      el('div', { class: 'modal-sheet' }, [
        el('h3', { text: 'Send with effect' }),
        el('div', { class: 'effect-picker-preview' }, [
          el('div', { class: 'bubble', style: 'background:var(--bubble-self-bg);color:var(--bubble-self-text);', text }),
        ]),
        el('span', { class: 'field-label', text: 'Bubble' }),
        el('div', { class: 'effect-picker-grid' }, BUBBLE_EFFECTS.map(option)),
        el('span', { class: 'field-label', text: 'Screen' }),
        el('div', { class: 'effect-picker-grid' }, SCREEN_EFFECTS.map(option)),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'secondary-button', onclick: close, text: 'Cancel' }),
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
