import { el, clear, initialsFor } from './dom.js';
import { getAvatarSignedUrl } from '../db/storage.js';

const urlCache = new Map(); // path -> signed url
const pending = new Map(); // path -> in-flight promise

async function loadUrl(path) {
  if (!path) return null;
  if (urlCache.has(path)) return urlCache.get(path);
  if (pending.has(path)) return pending.get(path);
  const promise = getAvatarSignedUrl(path)
    .then((url) => {
      urlCache.set(path, url);
      pending.delete(path);
      return url;
    })
    .catch(() => {
      pending.delete(path);
      return null;
    });
  pending.set(path, promise);
  return promise;
}

// Returns a DOM node immediately (showing initials), then swaps in the real
// image once its signed URL resolves, if the node is still attached.
export function renderAvatar(path, name, sizeClass = '') {
  const node = el('div', { class: `avatar-circle ${sizeClass}`.trim(), text: initialsFor(name) });
  if (path) {
    const cached = urlCache.get(path);
    if (cached) {
      clear(node);
      node.appendChild(el('img', { src: cached, alt: '' }));
    } else {
      loadUrl(path).then((url) => {
        if (!url || !node.isConnected) return;
        clear(node);
        node.appendChild(el('img', { src: url, alt: '' }));
      });
    }
  }
  return node;
}

export function invalidateAvatarCache(path) {
  urlCache.delete(path);
}
