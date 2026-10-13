// Doble de `src/js/api.js` para los tests de ocultos. Todo el estado vive en
// `globalThis.__DOBLE`, que el test rearma antes de cada caso.
//
// ⚠️ POR QUÉ ESTE DOBLE VALIDA (v=252) ──────────────────────────────────────
//
// `util/hidden-recover.js` pidió `/search?…&limit=20` desde que nació (v=205,
// 05/09) y el máximo de `/search` es 10 desde agosto: la función NUNCA recuperó
// nada, y **este archivo es la razón de que nadie se enterara**. El doble
// contestaba lo que le pedía el test sin mirar el `path`, o sea que fingía justo
// la parte que fallaba: el test verde certificaba una función muerta.
//
// La lección no es «hay que pegarle a la red de verdad» —un test que pide a
// Spotify es lento, gasta cuota y falla por motivos ajenos—. Es que un doble
// tiene que **hacer cumplir el contrato del servicio que reemplaza**. Lo que un
// doble sí puede fingir es el CONTENIDO de la respuesta; lo que no puede fingir
// es que una petición inválida sea válida.
//
// Así que acá van los límites REALES de la API, verificados y anotados en
// `CONTEXTO-TECNICO.md`. Un request que el Spotify de verdad rechazaría, este
// doble lo rechaza con el mismo error y con el mismo texto (`api.js:151` arma
// `Spotify ${status}: ${msg}`). Si alguien vuelve a subir un `limit`, el test
// que ya existe se pone rojo sin que nadie tenga que acordarse de mirarlo.
//
// Si mañana Spotify cambia un tope, se cambia ACÁ y el repo entero se revisa
// solo.
const TOPES = {
  // GET /search: bajó de 50 a 10 en la migración de agosto de 2026 (medido
  // 2026-08-06: 8 y 10 → 200; 12, 15, 20, 30, 50 → 400 «Invalid limit»).
  '/search': 10,
  // GET /albums/{id}/tracks: sigue en 50.
  '/albums': 50,
  // GET /playlists/{id}/items: 100 por página, como siempre.
  '/playlists': 100,
};

function topeDe(path) {
  const base = '/' + String(path).split('?')[0].split('/').filter(Boolean)[0];
  return TOPES[base];
}

/**
 * Los mismos 400 que devolvería la API de verdad. Es lo único que este doble NO
 * deja negociar: el test puede inventar la respuesta, no la validez del pedido.
 */
function validarPath(path) {
  const m = String(path).match(/[?&]limit=([^&]*)/);
  if (!m) return;
  const tope = topeDe(path);
  if (tope == null) return;
  const limit = Number(m[1]);
  if (!Number.isInteger(limit) || limit < 1 || limit > tope) {
    throw new Error('Spotify 400: Invalid limit');
  }
}

function d() { return globalThis.__DOBLE; }

// ── El snapshot miente como el de verdad (v=299) ─────────────────────────────
//
// `snapshot_id` es un CONTADOR de escrituras: cambia en cada POST y cada DELETE
// y nunca vuelve a un valor anterior. Con `'s' + largo` (lo que tenía el banco)
// un POST seguido de un DELETE deja el MISMO snapshot con otro contenido, y un
// caché que valida por snapshot pasa en verde estando roto. `snapshotPorLargo`
// vuelve a esa regla vieja SOLO para ver fallar la puerta 7 de la tanda 47.
//
// Y va RETRASADO como el real (CLAUDE.md: seguía viejo 40 s después de un PUT):
// durante las `retraso` lecturas de `/playlists/{id}?fields=…` siguientes a una
// escritura, devuelve el snapshot ANTERIOR, mientras los items ya son los nuevos.
function snapReal(pl) {
  return d().snapshotPorLargo ? 's' + pl.items.length : 's' + (pl.escrituras || 0);
}
function snapVisible(pl) {
  if (pl.retrasoRestante > 0) { pl.retrasoRestante--; return pl.snapAnterior; }
  return snapReal(pl);
}
function anotarEscritura(pl) {
  pl.snapAnterior = snapReal(pl);
  pl.escrituras = (pl.escrituras || 0) + 1;
  pl.retrasoRestante = d().retraso || 0;
}

/**
 * Una escritura en la playlist que NO pasa por la app: la otra compu. `cambiar`
 * recibe la playlist y la toca a mano; el snapshot avanza (y se retrasa) igual
 * que con una escritura de la app.
 */
export function escrituraAjena(id, cambiar) {
  const pl = d().playlists.find(p => p.id === id);
  cambiar(pl);
  anotarEscritura(pl);
}

// `meFalla` imita a `/me` caído (429 o red): `getCurrentUserId()` de verdad
// agota sus reintentos y TIRA, no devuelve `null` (lo usa la suite de la guarda
// del import, v=298).
export async function getCurrentUserId() {
  if (d().meFalla) throw new Error(d().meFalla);
  return d().me;
}

export async function spotifyFetch(path) {
  d().llamadas.push(path);
  // Antes de cualquier otra cosa: si el pedido es inválido, la API de verdad no
  // llega a mirar el resto. Contar la llamada primero igual, que es lo que
  // también hace el contador de cuota real.
  validarPath(path);
  const m = path.match(/^\/playlists\/([^/?]+)\?/);
  if (m) {
    // El fallo SIN respuesta HTTP, que es el que `hidden-sync.js` tiene que
    // saber distinguir de un 404. `fallarPlaylist` imita las dos formas en que
    // `api.js` se rinde sin haber hablado con Spotify: el corte de red
    // (`api.js:84`) y el 5xx agotado (`api.js:107`). Las dos tiran un `Error`
    // PELADO, sin `status` — y eso no es un detalle del doble, es la única
    // señal que separa «no existe» de «no pude preguntar».
    // Acepta una cadena (fallo pelado, SIN `status`: red o 5xx agotado) o
    // `{ msg, status }`, para los fallos que sí vienen de una respuesta HTTP y
    // que por tanto se distinguen — 403, 429, 401…
    if (d().fallarPlaylist) {
      const f = d().fallarPlaylist;
      if (typeof f === 'string') throw new Error(f);
      const err = new Error(f.msg);
      if (f.status != null) err.status = f.status;
      throw err;
    }
    const pl = d().playlists.find(p => p.id === m[1]);
    // ⚠️ `status` NO es decorativo: `api.js:125-131` lo pone en todo error que
    // venga de una RESPUESTA, y desde v=287 `findPlaylist()` decide si puede
    // tirar el id guardado mirando justo este número. Hasta esta versión el
    // doble tiraba `new Error('404 Not Found')` sin `status`, o sea que fingía
    // un 404 que el código nuevo leería como «no pude preguntar»: el doble se
    // habría quedado con la mitad del contrato, que es el fallo que su propia
    // cabecera documenta.
    if (!pl) {
      const err = new Error('Spotify 404: Resource not found');
      err.status = 404;
      throw err;
    }
    const out = { id: pl.id, name: pl.name, owner: { id: pl.owner } };
    // Solo si se pidió, como la API con `fields`.
    if (/snapshot_id/.test(path)) out.snapshot_id = snapVisible(pl);
    return out;
  }
  const t = path.match(/^\/playlists\/([^/?]+)\/items\?limit=1$/);
  if (t) {
    const pl = d().playlists.find(p => p.id === t[1]);
    return { total: pl ? pl.items.length : 0 };
  }
  if (d().buscar) return d().buscar(path);
  throw new Error(`el doble no sabe responder a ${path}`);
}

export async function getAllUserPlaylists() {
  // `fallarListado` es la red cortada del OTRO lado: `getAllUserPlaylists()`
  // tira pelado igual que `paginateAll`, que relanza lo que le dio `spotifyFetch`.
  if (d().fallarListado) throw new Error(d().fallarListado);
  // `listadoOculta` deja la playlist EXISTIENDO pero fuera de lo que devuelve
  // `/me/playlists`: el caché de 24 h que todavía no la vio, o el nombre
  // cambiado a mano en Spotify. Es la mitad sin la que el camino a la duplicada
  // no se puede reproducir.
  const fuera = new Set(d().listadoOculta || []);
  return d().playlists
    .filter(p => !fuera.has(p.id))
    .map(p => ({
      id: p.id, name: p.name, owner: { id: p.owner },
      // `listadoSnapshot` imita la lista de `/me/playlists` guardada hasta 24 h
      // en localStorage, con el snapshot que tenía CUANDO se guardó (v=299).
      ...(d().listadoSnapshot && p.id in d().listadoSnapshot ? { snapshot_id: d().listadoSnapshot[p.id] } : {}),
    }));
}

export async function getAllPlaylistItems(id, onProgress, opciones = {}) {
  const pl = d().playlists.find(p => p.id === id);
  const items = pl ? pl.items : [];
  // (v=299) Las páginas que costaría de verdad: `ceil(n/100)`, y 1 con la
  // playlist vacía (la API contesta igual). Se anotan APARTE de `llamadas` para
  // no moverle la cuenta a las suites que ya la miran.
  if (d().paginas) {
    const n = Math.max(1, Math.ceil(items.length / 100));
    for (let i = 0; i < n; i++) d().paginas.push({ id, offset: i * 100, useCache: opciones.useCache });
  }
  return items.map(t => ({ item: t }));
}

export async function addTracksToPlaylist(id, uris) {
  if (d().fallarAdd) throw new Error(d().fallarAdd);
  d().añadidas.push({ id, uris: [...uris] });
  const pl = d().playlists.find(p => p.id === id);
  for (const uri of uris) pl.items.push(d().pistaDeUri(uri));
  anotarEscritura(pl);
  // Como `api.js`: devuelve el snapshot NUEVO (el real, no el retrasado).
  return snapReal(pl);
}

export async function removeTracksFromPlaylist(id, uris) {
  if (d().fallarRemove) throw new Error(d().fallarRemove);
  d().quitadas.push({ id, uris: [...uris] });
  const pl = d().playlists.find(p => p.id === id);
  pl.items = pl.items.filter(t => !uris.includes(t.uri));
  anotarEscritura(pl);
  return snapReal(pl);
}

export async function createPlaylist(name) {
  const pl = { id: `nueva-${d().playlists.length}`, name, owner: d().me, items: [] };
  d().playlists.push(pl);
  d().creadas.push(name);
  return { id: pl.id };
}
