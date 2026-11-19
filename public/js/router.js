// Minimal hash router: #/path/part?key=value
const routes = [];
let onChange = () => {};

export function route(pattern, handler) { routes.push({ pattern, handler }); }
export function setOnChange(fn) { onChange = fn; }

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/home';
  const [path, query = ''] = raw.split('?');
  return { path: path.startsWith('/') ? path : `/${path}`, params: Object.fromEntries(new URLSearchParams(query)) };
}

export function go(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) { resolve(); return; }
  if (replace) location.replace(target); else location.hash = path;
}

export function resolve() {
  const { path, params } = parseHash();
  for (const r of routes) {
    const names = [];
    const re = new RegExp(`^${r.pattern.replace(/:([a-z]+)/gi, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
    const m = re.exec(path);
    if (m) {
      const args = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      onChange(path, { ...args, ...params });
      r.handler({ ...args }, params, path);
      return;
    }
  }
  go('/home', { replace: true });
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}

export function setQuery(patch) {
  const { path, params } = parseHash();
  const q = new URLSearchParams({ ...params, ...patch });
  for (const [k, v] of [...q]) if (v === '' || v === null) q.delete(k);
  history.replaceState(null, '', `#${path}${q.toString() ? '?' + q.toString() : ''}`);
}
