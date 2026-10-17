// Las etiquetas de género de cada artista, permanentes (v=312, tanda 60).
//
// PURO: sin imports, sin red, sin IndexedDB, sin DOM. La IndexedDB, el blob viejo de
// `localStorage` y el reloj se los pasa quien arma el almacén (`api/lastfm.js`), así
// esto se prueba en Node (`tests/generos-artista.test.mjs`).
//
// Hasta v=311 las etiquetas vivían en UN blob de `localStorage`
// (`lastfm_artist_tags_cache`, `{ [nombre en minúsculas]: { tags, at } }`) y
// `getCachedTags()` las daba por inexistentes pasados 30 días: lo que se buscó hace
// un mes se volvía a pedir, y una vista que recorra los ~2.000 artistas del
// historial no terminaba nunca de estar completa. Ahora, el molde de
// `mapa_artista_v1_` (`util/mapa-paises.js`):
//
//   · una clave por artista, `generos_artista_v1_<uid>_<nombre en minúsculas>`, con el
//     uid en la clave (la lista de artistas es dato de escucha) y DENTRO del valor
//     («abc» es prefijo de «abc_x»: al leer el rango de «abc» aparecen las de «abc_x»
//     y se descartan por el uid del valor). El nombre va con `toLowerCase()` tal cual,
//     sin normalizar más: es la clave que ya escribió el blob y la que leen todos.
//   · SIN caducidad, y en `CONSERVAR_PREFIJOS` (`util/limpiar-cache.js`).
//   · lo que contestó CADA fuente, por separado, y la decisión al leer:
//       { uid, nombre, fuentes: { lastfm, musicbrainz, statsfm, migrado } }
//     cada una `null` (no se pidió) o `{ tags: [{name, count}], fecha }` (`tags: []` es
//     «pregunté y no hay»). `migrado` es lo que vino del blob viejo o de un archivo
//     importado: el blob no dice de qué fuente salió cada etiqueta y no se inventa.
//   · la decisión es la mezcla de siempre (`mezclarEtiquetas`, la de `mergeCachedTags`
//     hasta v=311, sacada acá y escrita UNA vez: v=219) aplicada a las fuentes en el
//     orden en que se escribieron (por su `fecha`; a igualdad, en el orden de `FUENTES`).
//
// ⚠️ Cada fuente guarda su ÚLTIMA respuesta: volver a pedirle a Last.fm reemplaza lo de
// Last.fm y nada más. Hasta v=311 `setCachedTags` pisaba la entrada entera (lo de
// MusicBrainz y stats.fm incluido) y dos sincronizaciones de stats.fm se sumaban; ahora
// la segunda reemplaza a la primera.

export const PREFIJO_GENEROS = 'generos_artista_v1_';
// La marca de «el blob ya se migró», UNA por navegador (no por uid): con dos usuarios
// en el mismo navegador el blob es de quien lo llenó y no hay forma de saber de quién;
// va al primero que abre (anotado en `PENDIENTES.md`). Está en `CONSERVAR_CLAVES`.
export const CLAVE_MIGRADO = 'generos_artista_migrado_v1';
export const FUENTES = ['migrado', 'lastfm', 'musicbrainz', 'statsfm'];

export const prefijoGeneros = (uid) => `${PREFIJO_GENEROS}${uid}_`;
export const claveGeneros = (uid, nombre) => `${prefijoGeneros(uid)}${String(nombre).toLowerCase()}`;

const fuentesVacias = () => ({ migrado: null, lastfm: null, musicbrainz: null, statsfm: null });

// La mezcla de `mergeCachedTags` de v=311, sin cambiar una coma: los nombres en
// minúsculas, una sola vez cada uno, en el orden en que aparecieron; si llega uno que
// ya estaba, gana el `count` mayor; uno nuevo sin `count` vale 100 (así llegan los
// géneros de stats.fm).
export function mezclarEtiquetas(existentes, entrantes) {
  const byName = new Map();
  (existentes || []).forEach(t => {
    if (t?.name) byName.set(t.name.toLowerCase(), { ...t, name: t.name.toLowerCase() });
  });
  (entrantes || []).forEach(t => {
    if (!t?.name) return;
    const name = t.name.toLowerCase();
    const cur = byName.get(name);
    if (!cur) {
      byName.set(name, { name, count: t.count ?? 100 });
    } else if ((t.count ?? 0) > (cur.count ?? 0)) {
      byName.set(name, { ...cur, count: t.count });
    }
  });
  return [...byName.values()];
}

// Las fuentes que contestaron, en el orden en que se escribieron.
function fuentesEnOrden(registro) {
  const f = registro?.fuentes || {};
  return FUENTES.filter(n => f[n] && Array.isArray(f[n].tags))
    .sort((a, b) => (f[a].fecha ?? 0) - (f[b].fecha ?? 0) || FUENTES.indexOf(a) - FUENTES.indexOf(b));
}

// Lo que devuelve `getCachedTags`: la mezcla de las fuentes, o `null` si ninguna contestó.
export function decidirEtiquetas(registro) {
  const orden = fuentesEnOrden(registro);
  if (!orden.length) return null;
  return orden.reduce((acc, n) => mezclarEtiquetas(acc, registro.fuentes[n].tags), []);
}

export function fechaMasNueva(registro) {
  const fechas = fuentesEnOrden(registro).map(n => registro.fuentes[n].fecha ?? 0);
  return fechas.length ? Math.max(...fechas) : null;
}

const registroValido = (uid, v) => !!v && typeof v === 'object' && v.uid === uid && typeof v.nombre === 'string' && v.fuentes && typeof v.fuentes === 'object';

// El almacén: un `Map` en memoria (nombre en minúsculas → registro) con el prefijo
// ENTERO del uid, cargado una vez, para que los lectores sigan siendo sincrónicos.
//   leerRango(prefijo)      → [[clave, valor], …]   (`idbEntriesEnRango`: solo ese rango)
//   escribir(clave, valor)  → promesa                (`idbSet`)
//   escribirVarios(pares)   → promesa, todo o nada   (`idbSetVarios`: una transacción)
//   leerMarca()             → promesa del valor de `CLAVE_MIGRADO`
//   leerBlob()              → el objeto del blob viejo (`{}` si no hay)
export function crearAlmacenGeneros({ leerRango, escribir, escribirVarios, leerMarca, leerBlob, ahora = () => Date.now(), avisar = (...a) => console.warn(...a) }) {
  let uid = null;
  let mapa = null;
  let cargando = null;

  async function cargar(u) {
    if (!u) throw new Error('etiquetas: sin usuario no se puede leer');
    if (uid === u && mapa) return;
    if (cargando?.uid === u) return cargando.p;
    const p = (async () => {
      const m = new Map();
      for (const [, v] of await leerRango(prefijoGeneros(u))) {
        if (registroValido(u, v)) m.set(v.nombre, v);
      }
      // La migración del blob, una sola vez por navegador: la decide la MARCA, no que
      // falten claves. Así una migración que falló (no escribió nada: va en una sola
      // transacción) se reintenta en la carga siguiente.
      if (!(await leerMarca())) {
        const blob = leerBlob() || {};
        const pares = [];
        for (const [nombre, entrada] of Object.entries(blob)) {
          if (!entrada || !Array.isArray(entrada.tags)) continue;
          const k = String(nombre).toLowerCase();
          const prev = m.get(k);
          // TODAS, también las de más de 30 días: lo vencido era el TTL, no el dato.
          const reg = { uid: u, nombre: k, fuentes: { ...(prev?.fuentes || fuentesVacias()), migrado: { tags: entrada.tags, fecha: typeof entrada.at === 'number' ? entrada.at : ahora() } } };
          pares.push([claveGeneros(u, k), reg]);
        }
        pares.push([CLAVE_MIGRADO, { uid: u, fecha: ahora(), entradas: pares.length }]);
        try {
          await escribirVarios(pares);
          for (const [, reg] of pares.slice(0, -1)) m.set(reg.nombre, reg);
        } catch (e) {
          avisar('[etiquetas] no se pudo migrar el blob viejo (se reintenta en la próxima carga):', e?.message || e);
        }
      }
      if (cargando?.p === p) { uid = u; mapa = m; }
    })();
    cargando = { uid: u, p };
    try { await p; } finally { if (cargando?.p === p) cargando = null; }
  }

  const listo = () => !!mapa;

  function leer(nombre) {
    if (!mapa) return null;
    return decidirEtiquetas(mapa.get(String(nombre).toLowerCase()));
  }

  // Escribe lo que contestó una fuente. El `Map` cambia al instante (los lectores son
  // sincrónicos y la vista pinta enseguida); si la IndexedDB dice que no, vuelve a lo
  // que había, solo si nadie escribió encima mientras tanto (si no, lo de encima ya
  // incluye esto y se guardó o se va a deshacer por su cuenta).
  function guardar(nombre, tags, fuente) {
    if (!FUENTES.includes(fuente)) throw new Error(`etiquetas: fuente desconocida «${fuente}»`);
    if (!mapa) {
      avisar('[etiquetas] se quiso guardar sin haber cargado las de este usuario:', nombre);
      return Promise.resolve(false);
    }
    const k = String(nombre).toLowerCase();
    const prev = mapa.get(k);
    const reg = { uid, nombre: k, fuentes: { ...(prev?.fuentes || fuentesVacias()), [fuente]: { tags: Array.isArray(tags) ? tags.map(t => ({ ...t })) : [], fecha: ahora() } } };
    mapa.set(k, reg);
    const mio = mapa;
    return escribir(claveGeneros(uid, k), reg).then(() => true, (e) => {
      avisar(`[etiquetas] no se pudieron guardar las de «${nombre}»:`, e?.message || e);
      if (mio.get(k) === reg) { if (prev) mio.set(k, prev); else mio.delete(k); }
      return false;
    });
  }

  const contar = () => (mapa ? mapa.size : 0);

  // El formato del archivo de siempre (`tags.entries` de `exportAllData`):
  // `{ nombre: { tags: la decisión, at: la fecha más nueva de sus fuentes } }`.
  function exportar() {
    const out = {};
    for (const [k, reg] of mapa || []) {
      const tags = decidirEtiquetas(reg);
      if (tags) out[k] = { tags, at: fechaMasNueva(reg) };
    }
    return out;
  }

  // Lo importado va como `migrado` (no se sabe de qué fuente salió), en una transacción.
  async function importar(entries) {
    if (!mapa) throw new Error('etiquetas: sin cargar las de este usuario no se puede importar');
    let added = 0, updated = 0;
    const pares = [];
    for (const [nombre, entrada] of Object.entries(entries || {})) {
      if (!entrada || !Array.isArray(entrada.tags)) continue;
      const k = String(nombre).toLowerCase();
      const prev = mapa.get(k);
      if (prev) updated++; else added++;
      const tags = entrada.tags.filter(t => t && typeof t.name === 'string');
      pares.push([claveGeneros(uid, k), { uid, nombre: k, fuentes: { ...(prev?.fuentes || fuentesVacias()), migrado: { tags, fecha: typeof entrada.at === 'number' ? entrada.at : ahora() } } }]);
    }
    if (pares.length) await escribirVarios(pares);
    for (const [, reg] of pares) mapa.set(reg.nombre, reg);
    return { added, updated, total: pares.length };
  }

  return { cargar, listo, leer, guardar, contar, exportar, importar, get uid() { return uid; } };
}
