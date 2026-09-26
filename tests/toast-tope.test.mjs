// tests/toast-tope.test.mjs — el techo de toasts y su retiro (v=246)
//
// EL FALLO QUE PROTEGE ESTE ARCHIVO, en una línea: `dismiss()` de `ui/toast.js`
// solo ponía `.toast-exit` y esperaba `animationend` para quitar el nodo. Si la
// animación no corre —pestaña oculta o en segundo plano, que es donde corre la
// extensión de Chrome con la que se prueba— el evento no llega nunca y el toast
// queda en pantalla con opacidad 1. Y el techo solo cuenta los que NO están en
// `.toast-exit`, así que esos zombis no ocupaban cupo: cada toast que caducaba
// dejaba un cadáver y los nuevos se apilaban encima sin límite.
//
// Se prueba el `toast.js` REAL. Lo único que se sustituye es `bottom-layer.js`
// (el reparto de la capa de abajo), y el DOM es un doble mínimo que solo sabe lo
// que este módulo le pide. Los temporizadores son falsos: cada caso los dispara
// a mano, en el orden que quiere probar.
//
// Dos cosas más que se dejan escritas a propósito:
//   - `showToast` NO deduplica. La dedup es del llamador (`avisar()` de
//     `util/hidden-sync.js`, por tipo + mensaje, v=229). Meterla acá, por tipo,
//     es exactamente el bug que arregló v=229, así que el caso 2 lo pone a la
//     vista.
//   - El techo es 4: al llegar el quinto se va el más viejo.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert';

register('./dobles/loader-toast.mjs', pathToFileURL(import.meta.filename));

let n = 0;
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };

// ── DOM mínimo ───────────────────────────────────────────────────────────────
class El {
  constructor(tag) {
    this.tag = tag; this.children = []; this.parentNode = null;
    this._cls = new Set(); this.style = {}; this.attrs = {}; this.listeners = {}; this._text = '';
  }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._cls].join(' '); }
  get classList() {
    const s = this._cls;
    return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c) };
  }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  setAttribute(k, v) { this.attrs[k] = v; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(x => x !== this);
    this.parentNode = null;
  }
  addEventListener(tipo, fn, opts) { (this.listeners[tipo] ||= []).push({ fn, once: !!opts?.once }); }
  dispatch(tipo) {
    for (const l of [...(this.listeners[tipo] || [])]) {
      if (l.once) this.listeners[tipo] = this.listeners[tipo].filter(x => x !== l);
      l.fn();
    }
  }
  // Solo los dos selectores que usa toast.js: `.a` y `.a:not(.b)`.
  querySelectorAll(sel) {
    const m = /^\.([\w-]+)(?::not\(\.([\w-]+)\))?$/.exec(sel);
    if (!m) throw new Error(`el doble no soporta el selector ${sel}`);
    const out = [];
    const recorrer = el => {
      for (const c of el.children) {
        if (c._cls.has(m[1]) && !(m[2] && c._cls.has(m[2]))) out.push(c);
        recorrer(c);
      }
    };
    recorrer(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

const body = new El('body');
globalThis.document = {
  body,
  visibilityState: 'visible',
  createElement: tag => new El(tag),
  querySelector: sel => body.querySelector(sel),
};

// ── Temporizadores falsos ────────────────────────────────────────────────────
const pendientes = new Map();
let sig = 1;
globalThis.setTimeout = (fn) => { const id = sig++; pendientes.set(id, fn); return id; };
globalThis.clearTimeout = (id) => { pendientes.delete(id); };
/** Dispara todo lo que hay agendado ahora mismo (lo que se agende al correrlos queda para la próxima). */
function correrTemporizadores() {
  const lista = [...pendientes.values()];
  pendientes.clear();
  for (const fn of lista) fn();
}

const { showToast } = await import('../src/js/ui/toast.js');

const enDom = () => body.querySelectorAll('.toast');
const vivos = () => body.querySelectorAll('.toast:not(.toast-exit)');
const textos = () => enDom().map(t => t.children[0].textContent);

function resetear() {
  body.children.length = 0;
  pendientes.clear();
  globalThis.document.visibilityState = 'visible';
}

// ── 1. El techo: 4 a la vez, al quinto se va el más viejo ────────────────────
console.log('El techo: 4 a la vez');
resetear();
for (let i = 1; i <= 4; i++) showToast(`aviso ${i}`, 'info', 0);
eq(vivos().length, 4, 'con cuatro caben los cuatro');
eq(textos(), ['aviso 1', 'aviso 2', 'aviso 3', 'aviso 4'], 'y sigue el primero: nadie se ha ido todavía');
showToast('aviso 5', 'info', 0);
eq(vivos().length, 4, 'al llegar el quinto siguen cuatro');
eq(textos(), ['aviso 2', 'aviso 3', 'aviso 4', 'aviso 5'], 'y el que se fue es el más viejo');
for (let i = 6; i <= 8; i++) showToast(`aviso ${i}`, 'info', 0);
eq(textos(), ['aviso 5', 'aviso 6', 'aviso 7', 'aviso 8'], 'ocho toasts: quedan los cuatro últimos');
eq(enDom().length, 4, 'y los expulsados están fuera del DOM, no escondidos');

// ── 2. El techo cuenta todos los tipos, y `showToast` no deduplica ───────────
console.log('\nEl techo no mira el tipo; la dedup no es de acá');
resetear();
['error', 'success', 'warning', 'info', 'warning', 'error'].forEach((tipo, i) => showToast(`mixto ${i}`, tipo, 0));
eq(textos(), ['mixto 2', 'mixto 3', 'mixto 4', 'mixto 5'], 'seis de tipos mezclados: quedan los cuatro últimos, sea cual sea el tipo');
resetear();
showToast('el mismo texto', 'warning', 0);
showToast('el mismo texto', 'warning', 0);
eq(textos(), ['el mismo texto', 'el mismo texto'], 'dos iguales salen las dos: deduplicar es cosa de `avisar()`, y por tipo + mensaje');

// ── 3. Caducar con la pestaña VISIBLE ────────────────────────────────────────
console.log('\nCaducar con la pestaña visible');
resetear();
showToast('caduca', 'info', 1000);
correrTemporizadores();                                   // vence el plazo
eq(vivos().length, 0, 'al caducar deja de contar como vivo');
eq(enDom().length, 1, 'pero sigue en el DOM mientras corre su salida animada');
enDom()[0].dispatch('animationend');
eq(enDom().length, 0, 'y se va cuando termina la animación');

resetear();
showToast('caduca sin animación', 'info', 1000);
correrTemporizadores();
eq(enDom().length, 1, 'en salida');
correrTemporizadores();                                   // la red de seguridad
eq(enDom().length, 0, 'aunque `animationend` no llegue, la red de seguridad lo quita');

// ── 4. EL FALLO: caducar con la pestaña OCULTA ───────────────────────────────
console.log('\nCaducar con la pestaña oculta (el fallo de v=245)');
resetear();
globalThis.document.visibilityState = 'hidden';
showToast('caduca a escondidas', 'success', 1000);
correrTemporizadores();
eq(enDom().length, 0, 'sin pestaña visible no hay animación que esperar: el nodo se va ya');

resetear();
globalThis.document.visibilityState = 'hidden';
for (let i = 0; i < 10; i++) { showToast(`efímero ${i}`, 'warning', 1000); correrTemporizadores(); }
eq(enDom().length, 0, 'diez caducidades seguidas no dejan ni un cadáver');
for (let i = 0; i < 6; i++) showToast(`nuevo ${i}`, 'info', 0);
eq(enDom().length, 4, 'y los seis siguientes se quedan en cuatro, no en dieciséis');

// El ✕ con la pestaña oculta (una prueba automatizada lo pulsa así).
resetear();
globalThis.document.visibilityState = 'hidden';
showToast('con ✕', 'error', 0);
enDom()[0].children[1].onclick();
eq(enDom().length, 0, 'el ✕ también lo quita ya');

// ── 5. El ✕ es idempotente ───────────────────────────────────────────────────
console.log('\nEl ✕ dos veces');
resetear();
showToast('doble clic', 'error', 0);
const cerrar = enDom()[0].children[1];
cerrar.onclick(); cerrar.onclick();
eq(enDom()[0].listeners.animationend.length, 1, 'un doble clic no engancha dos veces la salida');
enDom()[0].dispatch('animationend');
eq(enDom().length, 0, 'y se va');
correrTemporizadores();                                   // la red de seguridad, ya sin nodo
eq(enDom().length, 0, 'sin efectos raros después');

console.log(`\nOK toast-tope: ${n} asserts`);
