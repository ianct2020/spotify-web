// tests/reveal-repetir.test.mjs — el modo «repetir» de `ui/reveal.js` (v=196)
//
// Qué se protege acá, y por qué no alcanza con mirarlo en la app.
//
// El modo repetir existe para DETECTAR elementos que no se animan: en el modo
// normal, uno que ya se animó y uno que no se anima nunca se ven exactamente
// igual —al volver a pasar, ninguno de los dos hace nada—, así que barrer una
// vista obliga a recargarla por cada tramo. Si el modo repetir se rompiera en
// silencio (dejando de re-armar al salir de pantalla), lo que pasaría es
// justamente eso: la herramienta de diagnóstico daría por «no anima» a lo que
// sí anima. Un fallo que se lee como un resultado.
//
// Y la otra mitad: en repetir el elemento se ESCONDE de nuevo. La regla dura del
// módulo —si algo falla, el contenido queda visible— tiene que seguir en pie,
// así que se comprueba también que salir de la ruta desarma todo.
//
// El doble de IntersectionObserver es sincrónico, igual que el de
// `lazy-img-poda.test.mjs`: `observe()` entrega el veredicto inicial en el acto
// y `frame()` reentrega los cambios, que es lo que hace el navegador en cada
// paso de renderizado.

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
function eq(a, b, nombre) {
  const bien = JSON.stringify(a) === JSON.stringify(b);
  if (!bien) console.log(`      esperaba ${JSON.stringify(b)}, dio ${JSON.stringify(a)}`);
  ok(bien, nombre);
}

// ── Doble de elemento ───────────────────────────────────────────────────────
// Solo lo que el módulo toca: `classList`, `style` y los listeners.
function el() {
  const clases = new Set();
  return {
    style: { transitionDelay: '', transition: '' },
    offsetHeight: 10,
    classList: {
      add: (...c) => c.forEach(x => clases.add(x)),
      remove: (...c) => c.forEach(x => clases.delete(x)),
      contains: c => clases.has(c),
    },
    _clases: clases,
    addEventListener() {},
    removeEventListener() {},
  };
}

// ── Doble de IntersectionObserver ───────────────────────────────────────────
const observers = [];
let dentro = new Map();          // target → ¿está en pantalla?
function instalarIO() {
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; this.targets = new Set(); this.estado = new Map(); observers.push(this); }
    observe(t) {
      if (this.targets.has(t)) return;
      this.targets.add(t);
      const is = !!dentro.get(t);
      this.estado.set(t, is);
      this.cb([{ target: t, isIntersecting: is }], this);
    }
    unobserve(t) { this.targets.delete(t); this.estado.delete(t); }
    disconnect() { this.targets.clear(); this.estado.clear(); }
    frame() {
      const cambios = [];
      for (const t of this.targets) {
        const is = !!dentro.get(t);
        if (this.estado.get(t) !== is) { this.estado.set(t, is); cambios.push({ target: t, isIntersecting: is }); }
      }
      if (cambios.length) this.cb(cambios, this);
      return cambios.length;
    }
  };
}
function frame() { return observers.reduce((n, o) => n + o.frame(), 0); }
function observados() { return observers.reduce((n, o) => n + o.targets.size, 0); }

// El módulo guarda SU observer en una variable de módulo y solo lo suelta con
// `routeteardown`. Sin este reinicio, el segundo bloque de test seguiría
// hablándole al doble del primero y las cuentas darían cero sin que nada esté
// roto: un test que falla por su propio andamiaje.
function reiniciar() {
  armadosDelDoc = [];
  disparar('routeteardown');
  observers.length = 0;
  instalarIO();
  dentro = new Map();
}

// ── Entorno mínimo ──────────────────────────────────────────────────────────
const almacen = new Map();
globalThis.localStorage = {
  getItem: k => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: k => almacen.delete(k),
};
const oyentes = {};
globalThis.document = {
  addEventListener: (t, f) => { (oyentes[t] ||= []).push(f); },
  querySelectorAll: () => armadosDelDoc,
};
let armadosDelDoc = [];
function disparar(tipo) { (oyentes[tipo] || []).forEach(f => f()); }
globalThis.window = globalThis;
globalThis.matchMedia = () => ({ matches: false });

instalarIO();
const { armReveal, getAnimMode, setAnimMode, repeatReveal, MODOS } =
  await import('../src/js/ui/reveal.js');

const ARMADO = 'reveal-armed';
const IN = 'reveal-in';

// ───────────────────────────────────────────────────────────────────────────
// 1. Los tres modos y el de fábrica.
// ───────────────────────────────────────────────────────────────────────────
{
  eq(MODOS, ['siempre', 'repetir', 'nunca'], 'los modos son tres');
  almacen.clear();
  eq(getAnimMode(), 'siempre', 'sin nada guardado, las animaciones van ENCENDIDAS');
  almacen.set('fonoteca_anim_v1', 'auto');
  eq(getAnimMode(), 'siempre', 'el modo viejo «auto» se lee como encendido, no como apagado');
  eq(setAnimMode('repetir'), 'repetir', 'repetir es un modo válido y se guarda');
  eq(getAnimMode(), 'repetir', 'y se lee de vuelta');
  ok(repeatReveal(), 'repeatReveal() lo confirma');
  eq(setAnimMode('cualquiera'), 'siempre', 'un modo inventado cae al de fábrica');
}

// ───────────────────────────────────────────────────────────────────────────
// 2. EL MODO NORMAL: una sola vez. Salir y volver a entrar no re-anima, y el
//    elemento se suelta del observer.
// ───────────────────────────────────────────────────────────────────────────
{
  reiniciar();
  setAnimMode('siempre');
  const a = el();
  dentro.set(a, false);
  ok(armReveal(a), 'se arma');
  ok(a.classList.contains(ARMADO), 'y nace escondido');
  eq(observados(), 1, 'con un observer mirándolo');

  dentro.set(a, true); frame();
  ok(a.classList.contains(IN), 'entra en pantalla y se revela');
  eq(observados(), 0, 'y en modo normal se SUELTA del observer: no vuelve a mirarse');

  dentro.set(a, false); frame();
  ok(!a.classList.contains(ARMADO) || a.classList.contains(IN),
    'salir de pantalla no lo vuelve a esconder');
}

// ───────────────────────────────────────────────────────────────────────────
// 3. EL MODO REPETIR: la entrada vuelve cada vez. Esto es lo que hace posible
//    barrer una vista buscando lo que no se anima.
// ───────────────────────────────────────────────────────────────────────────
{
  reiniciar();
  setAnimMode('repetir');
  const a = el();
  dentro.set(a, false);
  ok(armReveal(a), 'se arma igual que en modo normal');

  dentro.set(a, true); frame();
  ok(a.classList.contains(IN), 'primera entrada: se revela');
  eq(observados(), 1, 'y NO se suelta del observer — acá está todo el truco');

  dentro.set(a, false); frame();
  ok(a.classList.contains(ARMADO) && !a.classList.contains(IN),
    'al salir de pantalla vuelve a esconderse, listo para la próxima');
  eq(a.style.transition, '', 'y el `transition: none` con el que se rearma NO queda pegado');

  dentro.set(a, true); frame();
  ok(a.classList.contains(IN), 'segunda entrada: se vuelve a animar');
  dentro.set(a, false); frame();
  dentro.set(a, true); frame();
  ok(a.classList.contains(IN), 'y una tercera, y las que hagan falta');
  eq(observados(), 1, 'el observer nunca lo soltó');
}

// ───────────────────────────────────────────────────────────────────────────
// 4. LA REGLA DURA SIGUE EN PIE: nada puede quedar invisible.
//    En repetir el elemento se queda armado a propósito, así que el barrido de
//    `routeteardown` es lo único que lo devuelve a su estado limpio al irse.
// ───────────────────────────────────────────────────────────────────────────
{
  reiniciar();
  setAnimMode('repetir');
  const a = el(), b = el();
  dentro.set(a, true); dentro.set(b, false);
  armReveal(a); armReveal(b);
  armadosDelDoc = [a, b];

  ok(a.classList.contains(IN), 'a se reveló');
  ok(b.classList.contains(ARMADO) && !b.classList.contains(IN), 'b sigue escondido, esperando');

  disparar('routeteardown');
  ok(!a.classList.contains(ARMADO) && !a.classList.contains(IN), 'al cambiar de ruta, a queda limpio');
  ok(!b.classList.contains(ARMADO) && !b.classList.contains(IN),
    'y b, que nunca llegó a revelarse, queda VISIBLE en vez de invisible para siempre');
  eq(observados(), 0, 'y el observer se desconectó entero');
}

// ───────────────────────────────────────────────────────────────────────────
// 5. Apagadas: no se arma nada. Ni siquiera se toca el elemento.
// ───────────────────────────────────────────────────────────────────────────
{
  reiniciar();
  setAnimMode('nunca');
  const a = el();
  ok(!armReveal(a), 'con las animaciones apagadas, armReveal() dice que no armó');
  ok(!a.classList.contains(ARMADO), 'y el elemento no queda escondido');
  eq(observados(), 0, 'ni observado');
}

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron\n`);
process.exit(fallaron ? 1 : 0);
