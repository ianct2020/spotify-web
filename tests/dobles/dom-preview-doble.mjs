// Doble mínimo de DOM y de `<audio>` para correr `ui/preview-player.js` REAL en Node (tanda 115).
//
// Lo que sabe hacer es SOLO lo que el reproductor le pide: `createElement`, un `innerHTML` que entiende
// las plantillas del pill (etiquetas anidadas con atributos entre comillas dobles y texto), `querySelector`
// por `.clase`, `classList`, `style`, `hidden`, `textContent`, atributos, `onclick` y eventos. El `Audio`
// es un objeto que guarda lo que le piden (`play`, `pause`, `src`) y deja disparar sus eventos a mano.
// Los temporizadores son los de Node: cada caso los controla con `globalThis.__reloj` (ver `instalar`).

const VACIOS = new Set(['br', 'img', 'input', 'meta', 'hr', 'source']);

// (tanda 130) `style` sigue siendo un objeto plano (`style.width`, `style.display`), con `setProperty` /
// `getPropertyValue` / `removeProperty` NO enumerables para las variables CSS (`--mq-shift`) de `ui/hover-marquee.js`.
function crearEstilo() {
  const s = {};
  Object.defineProperties(s, {
    setProperty: { value(k, v) { s[k] = String(v); } },
    getPropertyValue: { value(k) { return s[k] ?? ''; } },
    removeProperty: { value(k) { delete s[k]; } },
  });
  return s;
}

class Nodo {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.parentNode = null;
    this._attrs = new Map(); this.style = crearEstilo(); this._listeners = {}; this._text = '';
    this.onclick = null;
  }
  // (tanda 130) Sin layout: `scrollWidth` / `clientWidth` los contesta `globalThis.__medidas` si el caso lo pone
  // (`{ scrollWidth(nodo), clientWidth(nodo) }`); si no, 0 (nada sobra, como antes).
  get scrollWidth() { return globalThis.__medidas?.scrollWidth?.(this) ?? 0; }
  get clientWidth() { return globalThis.__medidas?.clientWidth?.(this) ?? 0; }
  closest(sel) { let n = this; while (n && n.matches) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
  contains(otro) { let n = otro; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
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
  // (tanda 137) Un evento con `bubbles: true` sube por los padres hasta el <body> y de ahí al `document`, salvo que algún
  // listener llame a `stopPropagation()` (lo marca `_parado`; ver `evento()` abajo). Sin `bubbles: true`, lo de siempre: solo
  // los listeners del propio nodo (así arman sus eventos la 115, la 130 y la 136, que no cambian).
  dispatchEvent(ev) {
    ev.target ??= this;
    for (const fn of [...(this._listeners[ev.type] || [])]) fn.call(this, ev);
    if (ev.bubbles === true && !ev._parado) {
      const arriba = this.parentNode ?? (this === globalThis.document?.body ? globalThis.document : null);
      if (arriba) arriba.dispatchEvent(ev);
    }
    return !ev.defaultPrevented;
  }
  // (tanda 137) Sin layout: el rectángulo lo contesta `globalThis.__medidas.rect(nodo)` si el caso lo pone; si no, todo en 0.
  getBoundingClientRect() {
    return globalThis.__medidas?.rect?.(this) ?? { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }
  // (tanda 137) La captura del puntero, anotada: `hasPointerCapture` dice si la tiene.
  setPointerCapture(id) { this._captura = id; }
  releasePointerCapture(id) { if (this._captura === id) this._captura = undefined; }
  hasPointerCapture(id) { return this._captura === id; }
  click() { const ev = { type: 'click', target: this, preventDefault() {}, stopPropagation() {} }; if (this.onclick) this.onclick(ev); this.dispatchEvent(ev); }
  focus() { globalThis.document.activeElement = this; }
  // (tanda 136) `dataset`, como el del navegador: `dataset.playId` lee y escribe `data-play-id`. Lo pide la ficha de álbum.
  get dataset() {
    const n = this;
    const attr = (k) => 'data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    return new Proxy({}, {
      get: (_, k) => (typeof k === 'string' && n._attrs.has(attr(k)) ? n._attrs.get(attr(k)) : undefined),
      set: (_, k, v) => { n._attrs.set(attr(k), String(v)); return true; },
      has: (_, k) => n._attrs.has(attr(k)),
    });
  }
  // Selectores: `.a`, `.a.b`, `[atributo]`, `[atributo=valor]`, `tag`, y la lista separada por comas.
  // (tanda 136) Y `#id` (solo o delante de las clases): lo pide la ficha de álbum (`#alb-likes`). Lo de antes no cambia.
  // (tanda 138) Dos formas más, que antes tiraban «no soporta» y por eso no cambian nada de lo que ya andaba: clases DESPUÉS
  // del atributo (`.a[data-id="x"].b`) y el descendiente con espacios (`#lista .a`), que solo se prueba si el selector entero
  // no es uno de los simples de siempre. Las pide `features/skips.js`.
  matches(sel) {
    return sel.split(',').map(s => s.trim()).some((s) => {
      const m = /^([a-z]+)?(?:#([\w-]+))?((?:\.[\w-]+)*)(?:\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\])?((?:\.[\w-]+)*)$/i.exec(s);
      if (!m) {
        const partes = s.split(/\s+/);
        if (partes.length < 2) throw new Error(`el doble no soporta el selector ${s}`);
        if (!this.matches(partes[partes.length - 1])) return false;
        let i = partes.length - 2;
        for (let n = this.parentNode; n && n.matches && i >= 0; n = n.parentNode) if (n.matches(partes[i])) i--;
        return i < 0;
      }
      if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
      if (m[2] && this._attrs.get('id') !== m[2]) return false;
      const clases = ((m[3] || '') + (m[6] || '')).split('.').filter(Boolean);
      if (clases.some(c => !this.classList.contains(c))) return false;
      if (m[4] && !this._attrs.has(m[4])) return false;
      if (m[4] && m[5] !== undefined && this._attrs.get(m[4]) !== m[5]) return false;
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

// ── (tanda 137) Un evento que sube, como el del navegador ────────────────────
// `evento('keydown', { key: 'ArrowRight' })` o `evento('pointerdown', { button: 0, pointerId: 1, clientX: 50 })`: con
// `bubbles: true`, `defaultPrevented` y `stopPropagation()`. Es lo único que usa la propagación de `dispatchEvent`.
export function evento(type, props = {}) {
  return {
    type, bubbles: true, defaultPrevented: false, _parado: false, ...props,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._parado = true; },
  };
}

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
  // (tanda 130) El `resize` de la ventana: el pill vuelve a medir su etiqueta.
  if (typeof globalThis.window.addEventListener !== 'function') {
    const lWin = {};
    globalThis.window.addEventListener = (t, fn) => { (lWin[t] ||= []).push(fn); };
    globalThis.window.removeEventListener = (t, fn) => { lWin[t] = (lWin[t] || []).filter(f => f !== fn); };
    globalThis.window.dispatchEvent = (ev) => { for (const fn of [...(lWin[ev.type] || [])]) fn(ev); return true; };
  }
  return { body };
}
