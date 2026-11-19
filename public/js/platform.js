// Bridge between the web app and the native Android shell (Capacitor).
// Inside the APK, window.Capacitor and its plugins are injected by the native layer, so no bundler is needed.
// In a normal browser / installed PWA every function falls back to the standard web API.

const cap = () => globalThis.Capacitor;
export const isNative = () => !!cap()?.isNativePlatform?.();
export const plugin = (name) => (isNative() ? cap().Plugins?.[name] : null) || null;

function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';
}

async function blobToBase64Data(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Give the user a file (backup, CSV, PDF, report).
 *  - Web/PWA: normal browser download.
 *  - Android app: WebViews cannot download blob: URLs, so the file is written to the app cache with the Filesystem
 *    plugin and the Android share sheet opens ("Save to Drive", "Files", WhatsApp, email ...).
 * Returns 'downloaded' | 'shared' | 'cancelled'.
 */
export async function saveFile(name, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const fname = safeName(name);
  const FS = plugin('Filesystem');
  const Share = plugin('Share');
  if (isNative() && FS && Share) {
    const b64 = await blobToBase64Data(blob);
    const res = await FS.writeFile({ path: `exports/${fname}`, data: b64, directory: 'CACHE', recursive: true });
    try {
      await Share.share({ title: fname, dialogTitle: 'Save or send file', files: [res.uri] });
      return 'shared';
    } catch (e) {
      if (/cancel/i.test(String(e?.message))) return 'cancelled';
      throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

/** Share plain text with the Android share sheet (or the Web Share API). */
export async function shareText(text, title = 'LIC reminder') {
  const Share = plugin('Share');
  try {
    if (Share) { await Share.share({ title, text, dialogTitle: 'Share message' }); return true; }
    if (navigator.share) { await navigator.share({ title, text }); return true; }
  } catch (e) {
    if (/abort|cancel/i.test(String(e?.name + e?.message))) return false;
    throw e;
  }
  return false;
}

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** Open an external URL (WhatsApp, phone dialler) outside the app. */
export async function openExternal(url) {
  const L = plugin('AppLauncher');
  if (L) { try { await L.openUrl({ url }); return true; } catch { /* fall back */ } }
  const w = window.open(url, '_blank', 'noopener');
  if (!w) { location.href = url; }
  return true;
}

export const platformName = () => (isNative() ? 'Android app' : window.matchMedia?.('(display-mode: standalone)').matches ? 'Installed web app' : 'Web browser');
