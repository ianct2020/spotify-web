// tests/pref-key.test.mjs — claves de preferencia por usuario (v=159)
//
// Lo que se protege acá es la MIGRACIÓN. Si se prefija la clave sin mudar el
// valor que ya está guardado, la paleta que Ian eligió en v=157 se pierde en
// silencio: la app leería una clave vacía y volvería al violeta de fábrica sin
// dar ningún error.
//
// `storage.js` toca `localStorage` solo dentro de las funciones, nunca al
// importarse, así que alcanza con dejar un stub en `globalThis` antes de las
// llamadas.

function fakeLocalStorage(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    get length() { return m.size; },
    key: i => [...m.keys()][i] ?? null,
    _dump: () => Object.fromEntries(m),
  };
}

globalThis.localStorage = fakeLocalStorage();
const { prefKey, migratePrefKey } = await import('../src/js/storage.js');

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

const BASE = 'fonoteca_theme_v1';
const UID = 'orhs6wu5ykk7ql80u92ujn74o';
const PREF = `${BASE}__${UID}`;

console.log('\nprefKey()');
{
  globalThis.localStorage = fakeLocalStorage();
  eq(prefKey(BASE), BASE, 'sin user id todavía → clave pelada');

  globalThis.localStorage = fakeLocalStorage({ fonoteca_last_user_id: UID });
  eq(prefKey(BASE), PREF, 'con user id → clave prefijada');

  globalThis.localStorage = fakeLocalStorage({ fonoteca_last_user_id: '' });
  eq(prefKey(BASE), BASE, 'user id vacío se trata como ausente');

  const roto = { getItem() { throw new Error('sin acceso'); } };
  globalThis.localStorage = roto;
  eq(prefKey(BASE), BASE, 'localStorage que tira → clave pelada, no explota');
}

console.log('\nmigratePrefKey()');
{
  // El caso de Ian en la netbook: paleta guardada en la clave pelada.
  const ls = fakeLocalStorage({ fonoteca_last_user_id: UID, [BASE]: '{"colors":{"--color-accent":"#FF6B2C"}}' });
  globalThis.localStorage = ls;
  migratePrefKey(BASE);
  eq(ls.getItem(PREF), '{"colors":{"--color-accent":"#FF6B2C"}}', 'el valor viejo se muda a la clave prefijada');
  eq(ls.getItem(BASE), null, 'la clave pelada se borra después de mudarla');
}
{
  // Segunda pasada: no tiene que romper nada ni duplicar.
  const ls = fakeLocalStorage({ fonoteca_last_user_id: UID, [PREF]: 'ya-mio' });
  globalThis.localStorage = ls;
  migratePrefKey(BASE);
  eq(ls.getItem(PREF), 'ya-mio', 'idempotente: la segunda pasada no toca lo ya migrado');
}
{
  // Lo que el usuario eligió con SU clave manda sobre el resto de la vieja.
  const ls = fakeLocalStorage({ fonoteca_last_user_id: UID, [BASE]: 'de-antes', [PREF]: 'mio-nuevo' });
  globalThis.localStorage = ls;
  migratePrefKey(BASE);
  eq(ls.getItem(PREF), 'mio-nuevo', 'con la prefijada ya escrita, gana la prefijada');
  eq(ls.getItem(BASE), null, 'y la pelada se limpia igual, para que no vuelva a migrar');
}
{
  // El caso de esta máquina (escritorio): no hay nada guardado.
  const ls = fakeLocalStorage({ fonoteca_last_user_id: UID });
  globalThis.localStorage = ls;
  migratePrefKey(BASE);
  eq(ls.getItem(PREF), null, 'sin valor viejo no se inventa ninguno');
  eq(ls._dump(), { fonoteca_last_user_id: UID }, 'y no queda basura');
}
{
  // Primerísima carga: todavía no hubo `GET /me`, así que no hay a dónde mudar.
  const ls = fakeLocalStorage({ [BASE]: 'sin-dueno-todavia' });
  globalThis.localStorage = ls;
  migratePrefKey(BASE);
  eq(ls.getItem(BASE), 'sin-dueno-todavia', 'sin user id NO se toca la clave pelada');
}
{
  const roto = { getItem() { throw new Error('sin acceso'); }, setItem() {}, removeItem() {} };
  globalThis.localStorage = roto;
  let tiro = false;
  try { migratePrefKey(BASE); } catch { tiro = true; }
  ok(!tiro, 'localStorage que tira no propaga la excepción al arranque');
}

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron\n`);
process.exit(fallaron ? 1 : 0);
