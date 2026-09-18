// Base de discografías (v=229) — la parte PURA: sin IndexedDB, sin DOM, sin red.
//
// Por qué existe. Medido el 2026-09-18 (fonoteca-migracion/ULTIMO-CAMBIO.md):
//   - `/artists/{id}/albums` corta a los 100 requests ACUMULADOS y queda en 429
//     `QUOTA_EXCEEDED` más de una hora; `/search` corta a los ~700 y deja la
//     búsqueda de TODA la app caída otro tanto.
//   - Hasta v=228 la discografía de cada artista caducaba a los 30 días
//     (`idbGetCached` la BORRA al leerla vencida) y los dos «Actualizar» la
//     tiraban entera. Lo conseguido se volvía a pagar cada mes.
// Una discografía vieja no cambia: lo que aparece con el tiempo son
// lanzamientos nuevos. Así que la base NO caduca, y lo reciente se refresca
// aparte con una consulta barata (`/search` con `year:`, 1 request).
//
// ── La unión es por ID DE SPOTIFY, y solo por id ─────────────────────────────
// Ninguna fuente está entera: el nativo de Lana Del Rey dice `total: 70`,
// devuelve 62 y no trae nada de 2025-2026 que `/search` sí trae; `/search` no
// trae remixes ni colaboraciones que el nativo sí. Así que la base es la UNIÓN
// de todo lo que se haya visto, nunca «la fuente mejor reemplaza a la peor».
//
// ⚠️ Se deduplica por `id` y NO por `albumKey` ni por nombre. El id es la
// identidad exacta de un lanzamiento: dos discos distintos no comparten id
// nunca, así que la unión no puede fusionar American Football LP2/LP3, Crystal
// Castles I/II ni el ÷/=/+ de Ed Sheeran — que es lo que haría aflojar
// `albumKey`. Lo que el id NO junta (la misma edición con dos ids, la deluxe y
// la normal) lo sigue juntando `dedupDisco` al PINTAR, igual que antes: la base
// guarda lanzamientos, la vista decide cómo agruparlos.
//
// Nada se borra de la base. Un disco que el artista retiró de Spotify queda
// como tarjeta que al abrirse falla: se aceptó a cambio de no perder nunca lo
// que costó dos cuotas.

export const DISCO_BASE_PREFIX = 'discover_disco_base_v1_';
export const DISCO_BASE_FORMATO = 'fonoteca-discografias';
export const DISCO_BASE_VERSION = 1;

// Cada cuánto se mira lo reciente de un artista.
export const RECIENTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Con «Actualizar» se fuerza, salvo lo mirado hace menos de esto (dos clicks
// seguidos no tienen que gastar dos veces la cuota de búsqueda).
export const RECIENTE_FORZADO_MIN_MS = 12 * 60 * 60 * 1000;
// Requests de `/search` que puede gastar UNA ronda de escaneo en refrescar lo
// reciente. La cuota de `/search` es de ~700 y la comparte toda la app: 300
// artistas de golpe serían la mitad. Lo que no entra se hace en la ronda
// siguiente — mientras tanto se sirve la base, que no caduca.
export const PRESUPUESTO_REFRESCO = 100;
// Páginas de `/search` para lo reciente: 2 años de un artista caben en 1-2.
export const RECIENTE_MAX_PAGINAS = 5;

const HISTORIAL_MAX = 20;

/** Une dos listas de lanzamientos por id. Nunca pierde ninguno. */
export function unirItems(previos = [], nuevos = []) {
  const porId = new Map();
  const sinId = [];
  for (const al of previos) {
    if (al && al.id) porId.set(al.id, al);
    else if (al) sinId.push(al);
  }
  let agregados = 0;
  for (const al of nuevos) {
    if (!al) continue;
    if (!al.id) { sinId.push(al); continue; }
    const prev = porId.get(al.id);
    if (!prev) { porId.set(al.id, al); agregados++; continue; }
    // El mismo lanzamiento visto otra vez: gana el dato más nuevo, pero un
    // campo vacío no pisa uno lleno (una respuesta sin tapa no borra la tapa).
    const mezcla = { ...prev };
    for (const [k, v] of Object.entries(al)) {
      const vacio = v == null || v === '' || (Array.isArray(v) && !v.length) || v === 0;
      if (!vacio) mezcla[k] = v;
    }
    porId.set(al.id, mezcla);
  }
  return { items: [...porId.values(), ...sinId], agregados };
}

function anotar(base, entrada) {
  const h = Array.isArray(base.historial) ? base.historial.slice() : [];
  h.push(entrada);
  return h.slice(-HISTORIAL_MAX);
}

/**
 * Base nueva a partir de una discografía pedida entera (nativo o /search).
 * `t` = cuándo se pidió: para lo migrado es el `storedAt` de la caché vieja, no
 * «ahora», así los refrescos de lo reciente quedan escalonados como lo estaban.
 */
export function crearBase(items, { fuente, cortada, estimada = false, t = Date.now(), via = fuente }) {
  const { items: unidos } = unirItems([], items);
  return {
    v: DISCO_BASE_VERSION,
    items: unidos,
    fuente,
    cortada: !!cortada,
    estimada: !!estimada,
    completaAt: t,
    recienteAt: t,
    historial: [{ t, via, n: unidos.length, nuevos: unidos.length }],
  };
}

/** Suma a la base una discografía entera pedida de nuevo. */
export function sumarCompleta(base, items, { fuente, cortada, t = Date.now() }) {
  const { items: unidos, agregados } = unirItems(base.items, items);
  // «Cortada» = ninguna pedida entera trajo todo. Si esta vino entera, deja de
  // estarlo; si vino cortada, no empeora a una que ya estaba entera.
  const cortadaNueva = !!base.cortada && !!cortada;
  // `fuente` = de dónde salió la mejor pedida entera. Una entera reemplaza a
  // una cortada; entre dos enteras (o dos cortadas) gana el nativo.
  const fuenteNueva = (!cortada && base.cortada) ? fuente
    : (cortada && !base.cortada) ? base.fuente
    : (fuente === 'nativo' ? 'nativo' : base.fuente || fuente);
  return {
    ...base,
    items: unidos,
    fuente: fuenteNueva,
    cortada: cortadaNueva,
    estimada: !!base.estimada && !!cortada,
    completaAt: Math.max(base.completaAt || 0, t),
    recienteAt: Math.max(base.recienteAt || 0, t),
    historial: anotar(base, { t, via: fuente, n: items.length, nuevos: agregados }),
  };
}

/** Suma a la base lo que trajo el refresco de lo reciente. No toca `cortada`. */
export function sumarReciente(base, items, { t = Date.now(), year = null } = {}) {
  const { items: unidos, agregados } = unirItems(base.items, items);
  return {
    ...base,
    items: unidos,
    recienteAt: t,
    historial: anotar(base, { t, via: 'reciente', year, n: items.length, nuevos: agregados }),
  };
}

/** ¿Hay que mirar lo reciente de esta base? */
export function tocaReciente(base, { forzar = false, ahora = Date.now() } = {}) {
  const edad = ahora - (base.recienteAt || 0);
  return forzar ? edad > RECIENTE_FORZADO_MIN_MS : edad > RECIENTE_TTL_MS;
}

/**
 * El rango de años a pedir: desde el año del último refresco (o el anterior al
 * actual, lo que sea más viejo) hasta hoy. Con refrescos cada 30 días casi
 * siempre es «año pasado-este año»; si una base pasó mucho tiempo sin mirarse,
 * el rango se estira solo para no dejar un hueco.
 */
export function rangoReciente(base, ahora = Date.now()) {
  const actual = new Date(ahora).getUTCFullYear();
  const ultimo = base.recienteAt ? new Date(base.recienteAt).getUTCFullYear() : actual - 1;
  const desde = Math.min(ultimo, actual - 1);
  return `${desde}-${actual}`;
}

/**
 * Junta dos bases del mismo artista (la de este navegador y la importada).
 * Conmutativa en lo que importa: los items son la unión, y una base entera
 * gana a una cortada venga de donde venga.
 */
export function fusionarBases(a, b, t = Date.now()) {
  if (!a) return b;
  if (!b) return a;
  const { items, agregados } = unirItems(a.items, b.items);
  const enteras = [a, b].filter(x => !x.cortada);
  const ref = enteras.find(x => x.fuente === 'nativo') || enteras[0] || (a.fuente === 'nativo' ? a : b);
  const historial = [...(a.historial || []), ...(b.historial || [])]
    .sort((x, y) => (x.t || 0) - (y.t || 0));
  historial.push({ t, via: 'importacion', n: b.items.length, nuevos: agregados });
  return {
    v: DISCO_BASE_VERSION,
    items,
    fuente: ref.fuente,
    cortada: !!a.cortada && !!b.cortada,
    estimada: !!ref.estimada,
    completaAt: Math.max(a.completaAt || 0, b.completaAt || 0),
    recienteAt: Math.max(a.recienteAt || 0, b.recienteAt || 0),
    historial: historial.slice(-HISTORIAL_MAX),
  };
}

/** ¿Tiene forma de base? Lo importado viene de un archivo: no se confía. */
export function esBaseValida(b) {
  return !!b && typeof b === 'object' && Array.isArray(b.items)
    && b.items.every(al => al && typeof al === 'object' && typeof al.id === 'string' && al.id)
    && (b.fuente === 'nativo' || b.fuente === 'busqueda');
}

/** El JSON de «Exportar base». `bases` = { artistId: base }. */
export function armarExportacion(bases, ahora = new Date()) {
  let lanzamientos = 0;
  for (const b of Object.values(bases)) lanzamientos += b.items.length;
  return {
    _format: DISCO_BASE_FORMATO,
    _version: DISCO_BASE_VERSION,
    _exportedAt: ahora.toISOString(),
    artistas: Object.keys(bases).length,
    lanzamientos,
    bases,
  };
}

/**
 * Valida un JSON importado. Devuelve `{ ok, bases, descartadas, error }`:
 * las entradas mal formadas se cuentan y se dejan fuera, no tiran el resto.
 */
export function leerImportacion(parsed) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'El archivo no es un JSON válido.' };
  if (parsed._format !== DISCO_BASE_FORMATO) {
    return { ok: false, error: `No es una exportación de la base de discografías (formato «${parsed._format || 'desconocido'}»).` };
  }
  if (parsed._version !== DISCO_BASE_VERSION) {
    return { ok: false, error: `Versión ${parsed._version} de la base: esta versión de la app solo lee la ${DISCO_BASE_VERSION}.` };
  }
  const bases = {};
  let descartadas = 0;
  for (const [id, b] of Object.entries(parsed.bases || {})) {
    if (typeof id === 'string' && id && esBaseValida(b)) bases[id] = b;
    else descartadas++;
  }
  return { ok: true, bases, descartadas };
}

