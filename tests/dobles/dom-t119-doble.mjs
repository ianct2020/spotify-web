// Un DOM de mentira, chico, para los tests de la tanda 119 (`wrapped-siempre` y `ficha-artista-play`).
//
// Lo que los dobles de antes no hacían y estos dos tests necesitan: PARSEAR el `innerHTML` que escribe el módulo real,
// para que sus `querySelectorAll` encuentren lo que acaba de pintar y un clic burbujee de verdad hasta la fila (el
// `stopPropagation()` del ▶ se prueba así, no leyendo el fuente).
//
// Selectores: `#id`, `.clase`, `tag`, `[attr]`, `[attr="v"]`, `[attr^="v"]`, combinados, con descendiente y con coma.
// `innerHTML` de lectura re-serializa con los atributos crudos, en su orden: el `sha256` del test sale de ahí, y corre
// igual contra `f6f4df1` y contra hoy.

const VACIOS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link']);

class Texto {
  constructor(t) { this.texto = t; this.parent = null; }
  serializar() { return this.texto; }
  get textContent() { return this.texto.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'); }
}

function parsear(html, padre) {
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:=(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
  let pila = [padre], i = 0, m;
  const tope = () => pila[pila.length - 1];
  while ((m = re.exec(html))) {
    if (m.index > i) tope().sumar(new Texto(html.slice(i, m.index)));
    i = re.lastIndex;
    const [, cierre, tag, attrs, auto] = m;
    if (cierre) { if (pila.length > 1) pila.pop(); continue; }
    const e = new Elemento(tag.toLowerCase());
    for (const a of attrs.matchAll(/([^\s=>/]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g)) e.attrs.set(a[1], a[2] ?? a[3] ?? '');
    tope().sumar(e);
    if (!auto && !VACIOS.has(e.tag)) pila.push(e);
  }
  if (i < html.length) tope().sumar(new Texto(html.slice(i)));
}

function compilar(selector) {
  return selector.split(',').map((s) => s.trim().split(/\s+/).map((parte) => {
    const c = { tag: null, id: null, clases: [], attrs: [] };
    const t = parte.match(/^[a-zA-Z][\w-]*/);
    if (t) c.tag = t[0].toLowerCase();
    for (const m of parte.matchAll(/#([\w-]+)/g)) c.id = m[1];
    const sinAttrs = parte.replace(/\[[^\]]*\]/g, '');
    for (const m of sinAttrs.matchAll(/\.([\w-]+)/g)) c.clases.push(m[1]);
    for (const m of parte.matchAll(/\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/g)) c.attrs.push({ n: m[1], op: m[2], v: m[3] });
    return c;
  }));
}
function casa(e, c) {
  if (c.tag && e.tag !== c.tag) return false;
  if (c.id && e.attrs.get('id') !== c.id) return false;
  for (const k of c.clases) if (!e.clases().includes(k)) return false;
  for (const a of c.attrs) {
    if (!e.attrs.has(a.n)) return false;
    if (a.op === '=' && e.attrs.get(a.n) !== a.v) return false;
    if (a.op === '^=' && !e.attrs.get(a.n).startsWith(a.v)) return false;
  }
  return true;
}
function casaCadena(e, cadena) {
  let i = cadena.length - 1;
  if (!casa(e, cadena[i])) return false;
  i--;
  for (let p = e.parent; p && i >= 0; p = p.parent) if (p instanceof Elemento && casa(p, cadena[i])) i--;
  return i < 0;
}

class Nodo {
  constructor() { this.hijos = []; this.oyentes = {}; }
  sumar(n) { n.parent = this; this.hijos.push(n); return n; }
  appendChild(n) { n.remove?.(); return this.sumar(n); }
  elementos() { return this.hijos.filter((h) => h instanceof Elemento); }
  querySelectorAll(selector) {
    const cadenas = compilar(selector), salida = [];
    const andar = (n) => { for (const h of n.elementos()) { if (cadenas.some((c) => casaCadena(h, c))) salida.push(h); andar(h); } };
    andar(this);
    return salida;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getElementById(id) { return this.querySelector(`#${id}`); }
  addEventListener(tipo, f) { (this.oyentes[tipo] ||= []).push(f); }
  removeEventListener(tipo, f) { this.oyentes[tipo] = (this.oyentes[tipo] || []).filter((x) => x !== f); }
  dispatchEvent(ev) {
    ev.target ||= this;
    for (let n = this; n; n = n.parent) {
      if (n.onclick && ev.type === 'click') n.onclick(ev);
      for (const f of n.oyentes?.[ev.type] || []) f(ev);
      if (ev.detenido) break;
    }
    return true;
  }
}

export class Elemento extends Nodo {
  constructor(tag) {
    super();
    this.tag = tag; this.attrs = new Map(); this.parent = null; this.onclick = null; this.style = {};
    const yo = this;
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? yo.attrs.get('data-' + k.replace(/[A-Z]/g, (l) => '-' + l.toLowerCase())) : undefined),
      set: (_, k, v) => { yo.attrs.set('data-' + k.replace(/[A-Z]/g, (l) => '-' + l.toLowerCase()), String(v)); return true; },
      has: (_, k) => yo.attrs.has('data-' + String(k).replace(/[A-Z]/g, (l) => '-' + l.toLowerCase())),
    });
    this.classList = {
      add: (...c) => { const x = yo.clases(); for (const k of c) if (!x.includes(k)) x.push(k); yo.attrs.set('class', x.join(' ')); },
      remove: (...c) => { yo.attrs.set('class', yo.clases().filter((k) => !c.includes(k)).join(' ')); },
      toggle: (k, on) => { const v = on ?? !yo.clases().includes(k); v ? yo.classList.add(k) : yo.classList.remove(k); return v; },
      contains: (k) => yo.clases().includes(k),
    };
  }
  clases() { return (this.attrs.get('class') || '').split(/\s+/).filter(Boolean); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  removeAttribute(n) { this.attrs.delete(n); }
  hasAttribute(n) { return this.attrs.has(n); }
  get id() { return this.attrs.get('id') || ''; }
  get title() { return this.attrs.get('title') || ''; }
  set title(v) { this.attrs.set('title', String(v)); }
  get disabled() { return this.attrs.has('disabled'); }
  set disabled(v) { v ? this.attrs.set('disabled', '') : this.attrs.delete('disabled'); }
  get hidden() { return this.attrs.has('hidden'); }
  set hidden(v) { v ? this.attrs.set('hidden', '') : this.attrs.delete('hidden'); }
  get innerHTML() { return this.hijos.map((h) => h.serializar()).join(''); }
  set innerHTML(html) { this.hijos = []; parsear(String(html), this); }
  get textContent() { return this.hijos.map((h) => h.textContent).join(''); }
  set textContent(t) { this.hijos = []; this.sumar(new Texto(String(t))); }
  serializar() {
    const a = [...this.attrs].map(([k, v]) => (v === '' && !['class', 'style'].includes(k) ? ` ${k}` : ` ${k}="${v}"`)).join('');
    return VACIOS.has(this.tag) ? `<${this.tag}${a}>` : `<${this.tag}${a}>${this.innerHTML}</${this.tag}>`;
  }
  remove() { if (this.parent) { this.parent.hijos = this.parent.hijos.filter((h) => h !== this); this.parent = null; } }
  closest(selector) { const c = compilar(selector); for (let n = this; n instanceof Elemento; n = n.parent) if (c.some((x) => casa(n, x[x.length - 1]))) return n; return null; }
  /** Un clic que burbujea: `onclick` y oyentes de acá hasta la raíz, salvo `stopPropagation()`. */
  click() {
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', target: this, detenido: false, cancelado: false, stopPropagation() { this.detenido = true; }, preventDefault() { this.cancelado = true; } });
  }
}

/** Un `document` de mentira con `body` y el `dispatchEvent` de `previewchange`. Se engancha a `globalThis`. */
export function instalarDom() {
  const doc = new Nodo();
  doc.body = doc.sumar(new Elemento('body'));
  doc.documentElement = doc.body;
  doc.createElement = (t) => new Elemento(t);
  globalThis.document = doc;
  return doc;
}
