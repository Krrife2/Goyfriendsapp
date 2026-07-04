// Thin wrapper around the vendored libsodium build (loaded as two classic
// <script> tags in index.html, which set up window.libsodium then window.sodium).
// Vendored locally rather than fetched from a CDN so the PWA shell works offline
// and doesn't depend on a third party being up.

const readyPromise = (async () => {
  if (typeof window === 'undefined' || !window.sodium) {
    throw new Error('libsodium-wrappers not loaded — check index.html script tags');
  }
  await window.sodium.ready;
  return window.sodium;
})();

export async function getSodium() {
  return readyPromise;
}
