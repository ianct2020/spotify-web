// Doble mínimo de DOM y de `<audio>` para correr `ui/preview-player.js` REAL en Node (tanda 115).
//
// Lo que sabe hacer es SOLO lo que el reproductor le pide: `createElement`, un `innerHTML` que entiende
// las plantillas del pill (etiquetas anidadas con atributos entre comillas dobles y texto), `querySelector`
// por `.clase`, `classList`, `style`, `hidden`, `textContent`, atributos, `onclick` y eventos. El `Audio`
// es un objeto que guarda lo que le piden (`play`, `pause`, `src`) y deja disparar sus eventos a mano.
// Los temporizadores son los de Node: cada caso los controla con `globalThis.__reloj` (ver `instalar`).

const VACIOS = new Set(['br', 'img', 'input', 'meta', 'hr', 'source']);

class Nodo {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.parentNode = null;
    this._attrs = new Map(); this.style = {}; this._listeners = {}; this._text = '';
    this.onclick = null;
  }
  get className() { return this._attrs.get('class') || ''; }
  set className(v) { this._attrs.set('class', String(v)); }
  get classList() {
    const leer = () => new Set(this.className.split(/\s+/).filter(Boolean));
    const escribir = (s) => { this.className = [...s].join(' '); };
    return {
      add: (...c) => { const s = leer(); c.forEach(x => s.add(x)); escribir(s); },
      remove: (...c) => { const s = leer(); c.forEach(x => s.delete(x)); escribir(s); },
      contains: (c) => leer().has(c),
      toggle: (c, on) => { const s = leer(); const v = on === undefined ? !s.has(c) : !!on; if (v) s.add(c); else s.delete(c); escribir(s); return v; },
    };
  }
  get hidden() { return this._attrs.has('hidden'); }
  set hidden(v) { if (v) this._attrs.set('hidden', ''); else this._attrs.delete('hidden'); }
  get title() { return this._attrs.get('title') || ''; }
  set title(v) { this._attrs.set('title', String(v)); }
  get id() { return this._attrs.get('id') || ''; }
  setAttribute(k, v) { this._attrs.set(k, String(v)); }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  hasAttribute(k) { return this._attrs.has(k); }
  removeAttribute(k) { this._attrs.delete(k); }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this.children = []; this._text = String(v); }
  get innerHTML() { return this._html ?? this._text; }
  set innerHTML(html) { this.children = []; this._text = ''; this._html = String(html); parsear(String(html), this); }
  appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; }
  remove() { if (!this.parentNode) return; this.parentNode.children = this.parentNode.children.filter(x => x !== this); this.parentNode = null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === globalThis.document?.body; }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter(f => f !== fn); }
  dispatchEvent(ev) { ev.target ??= this; for (const fn of [...(this._listeners[ev.type] || [])]) fn.call(this, ev); return true; }
  click() { const ev = { type: 'click', target: this, preventDefault() {}, stopPropagation() {} }; if (this.onclick) this.onclick(ev); this.dispatchEvent(ev); }
  focus() { globalThis.document.activeElement = this; }
  // Selectores: `.a`, `.a.b`, `[atributo]`, `[atributo=valor]`, `tag`, y la lista separada por comas.
  matches(sel) {
    return sel.split(',').map(s => s.trim()).some((s) => {
      const m = /^([a-z]+)?((?:\.[\w-]+)*)(?:\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\])?$/i.exec(s);
      if (!m) throw new Error(`el doble no soporta el selector ${s}`);
      if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
      const clases = (m[2] || '').split('.').filter(Boolean);
      if (clases.some(c => !this.classList.contains(c))) return false;
      if (m[3] && !this._attrs.has(m[3])) return false;
      if (m[3] && m[4] !== undefined && this._attrs.get(m[3]) !== m[4]) return false;
      return true;
    });
  }
  querySelectorAll(sel) {
    const out = [];
    const rec = (n) => { for (const c of n.children) { if (c.matches(sel)) out.push(c); rec(c); } };
    rec(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

class Texto {
  constructor(t) { this._t = t; this.parentNode = null; this.children = []; }
  get textContent() { return this._t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
  matches() { return false; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); }
}

function parsear(html, raiz) {
  const pila = [raiz];
  const re = /<\/([a-z0-9]+)\s*>|<([a-z0-9]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    const arriba = pila[pila.length - 1];
    if (m[1]) { if (pila.length > 1) pila.pop(); continue; }
    if (m[2]) {
      const n = new Nodo(m[2]);
      const ra = /([\w:-]+)(?:="([^"]*)")?/g; let a;
      while ((a = ra.exec(m[3] || ''))) n._attrs.set(a[1], a[2] ?? '');
      arriba.appendChild(n);
      if (!VACIOS.has(m[2].toLowerCase()) && !/\/>$/.test(m[0])) pila.push(n);
      continue;
    }
    if (m[4] && m[4].trim()) { const t = new Texto(m[4].trim()); t.parentNode = arriba; arriba.children.push(t); }
  }
}

// ── El <audio> ───────────────────────────────────────────────────────────────
export class AudioDoble {
  constructor() {
    this._listeners = {}; this._attrs = new Map();
    this.paused = true; this.currentTime = 0; this.duration = NaN; this.error = null;
    this.preload = ''; this.volume = 1;
    this.llamadas = [];                 // 'play' | 'pause' | 'src=…' | 'removeAttribute(src)'
    this.rechazarPlay = null;           // si se pone un Error, la próxima promesa de play() lo rechaza
    AudioDoble.instancias.push(this);
  }
  get src() { return this._attrs.get('src') || ''; }
  set src(v) { this._attrs.set('src', String(v)); this.llamadas.push('src=' + v); this.currentTime = 0; }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  removeAttribute(k) { this._attrs.delete(k); this.llamadas.push('removeAttribute(' + k + ')'); }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  emitir(t) { for (const fn of [...(this._listeners[t] || [])]) fn({ type: t, target: this }); }
  // `colgarPlay = true`: la promesa de la próxima `play()` queda pendiente (cargando) y, como en el navegador,
  // se rechaza con AbortError cuando llega un `pause()` antes de que arranque.
  play() {
    this.llamadas.push('play');
    if (this.rechazarPlay) { const e = this.rechazarPlay; this.rechazarPlay = null; return Promise.reject(e); }
    this.paused = false; this.emitir('play');
    if (this.colgarPlay) {
      this.colgarPlay = false;
      return new Promise((_, rechazar) => { this._abortarPlay = () => rechazar(Object.assign(new Error('The play() request was interrupted by a call to pause()'), { name: 'AbortError' })); });
    }
    return Promise.resolve();
  }
  pause() {
    this.llamadas.push('pause');
    if (this._abortarPlay) { const a = this._abortarPlay; this._abortarPlay = null; queueMicrotask(a); }
    if (!this.paused) { this.paused = true; this.emitir('pause'); }
  }
}
AudioDoble.instancias = [];

// ── Instalar el `document` y el `Audio` globales ─────────────────────────────
export function instalar() {
  const body = new Nodo('body');
  const lDoc = {};
  globalThis.document = {
    body,
    activeElement: null,
    createElement: (t) => new Nodo(t),
    getElementById: (id) => body.querySelectorAll('[id]').find(n => n.id === id) || null,
    querySelector: (s) => body.querySelector(s),
    querySelectorAll: (s) => body.querySelectorAll(s),
    addEventListener: (t, fn) => { (lDoc[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { lDoc[t] = (lDoc[t] || []).filter(f => f !== fn); },
    dispatchEvent: (ev) => { for (const fn of [...(lDoc[ev.type] || [])]) fn(ev); return true; },
  };
  globalThis.CustomEvent ??= class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
  globalThis.Audio = AudioDoble;
  globalThis.window ??= globalThis;
  return { body };
}
