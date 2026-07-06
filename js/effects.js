// Full-screen effect animations (Balloons, Confetti, Love), plus a lookup of
// which effect names are "bubble" effects (animate the message bubble itself,
// handled directly in threadView.js) vs "screen" effects (handled here).

export const BUBBLE_EFFECTS = ['slam', 'loud', 'gentle', 'invisible-ink'];
export const SCREEN_EFFECTS = ['balloons', 'confetti', 'love'];

const SCREEN_EFFECT_CONFIG = {
  balloons: { emoji: ['🎈'], count: 18, duration: 4500, direction: 'up' },
  confetti: { emoji: ['▪️', '▫️', '🟩', '🟢'], count: 60, duration: 3200, direction: 'down' },
  love: { emoji: ['❤️'], count: 16, duration: 3000, direction: 'up' },
};

// Tracks which messages' effects have already played this session, so a
// polling refresh or realtime resync never replays an animation the client
// already showed. Resets on page reload — acceptable for a lightweight effect.
const playedEffectMessageIds = new Set();

export function hasPlayedEffect(messageId) {
  return playedEffectMessageIds.has(messageId);
}

export function markEffectPlayed(messageId) {
  playedEffectMessageIds.add(messageId);
}

export function playScreenEffect(effectName) {
  const config = SCREEN_EFFECT_CONFIG[effectName];
  if (!config) return;

  const overlay = document.createElement('div');
  overlay.className = 'screen-effect-overlay';
  document.body.appendChild(overlay);

  for (let i = 0; i < config.count; i++) {
    const particle = document.createElement('span');
    particle.className = 'screen-effect-particle';
    particle.textContent = config.emoji[Math.floor(Math.random() * config.emoji.length)];
    const startX = Math.random() * 100;
    const drift = (Math.random() - 0.5) * 40;
    const delay = Math.random() * (config.duration * 0.4);
    const duration = config.duration * (0.7 + Math.random() * 0.6);
    const size = 16 + Math.random() * 20;

    particle.style.left = `${startX}vw`;
    particle.style.top = config.direction === 'up' ? '100vh' : '-40px';
    particle.style.fontSize = `${size}px`;
    particle.style.setProperty('--drift', `${drift}vw`);
    particle.style.setProperty('--travel', config.direction === 'up' ? '-115vh' : '115vh');
    particle.style.animation = `screen-effect-fall ${duration}ms ease-in ${delay}ms forwards`;
    overlay.appendChild(particle);
  }

  setTimeout(() => overlay.remove(), config.duration + 600);
}
