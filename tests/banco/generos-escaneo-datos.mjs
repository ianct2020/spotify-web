// Los datos de mentira del banco `generos-escaneo.html` (v=313, tanda 61).
//
// 🔴 TODO INVENTADO: artistas, minutos, temas y etiquetas. El repo es público y ningún dato de
// escucha de nadie entra acá.
//
// Doce artistas de 10 min o más y dos de menos. Tres llegan con un registro SEMBRADO en el
// almacén de etiquetas (`generos_artista_v1_<uid>_<nombre>`): uno que Last.fm ya contestó, uno
// migrado del blob viejo con etiquetas (los dos «ya buscados») y uno migrado VACÍO (se vuelve a
// pedir). Lo que tiene que dar cada uno está escrito al lado, a mano, y `ESPERADO` lo junta: el
// banco compara la pantalla contra esta cuenta, no contra la del código que prueba.

const T = (min) => [Math.max(1, Math.round(min / 3)), min, 2021, 2025, [[2025, min, 1]], '2021-03-01'];
const tema = (titulo, min) => [titulo, 3, min, 'banco-' + titulo.toLowerCase().replace(/\W+/g, '-')];
const E = (name, count) => ({ name, count, url: 'https://www.last.fm/tag/inventada' });

// nombre, minutos, lo que contesta Last.fm (`{ tags, artista }`, o `{ error: 6 }`) y el sembrado.
export const ARTISTAS = [
  ['Lumbre Norte', 500, { tags: [E('Cumbia Lunar', 100)] }, 'lastfm'],                       // ya buscado: no se pide
  ['Cassia Vento', 400, { tags: [E('Vals Sintético', 100)] }, 'migrado'],                    // ya buscado (migrado con etiquetas)
  ['Los Duendes del Faro', 300, { tags: [E('Folk de Faro', 100), E('Niebla Pop', 40)] }, 'migrado-vacio'], // migrado [] → se pide
  ['Marea Gris', 250, { tags: [E('Oleaje Lento', 100), E('ruido de puerto', 3)] }],          // el filtro deja 1
  ['Tordo Azul', 200, { error: 6 }],                                                          // «no encontrado» → []
  ['Nube Baja', 150, { tags: [E('llovizna', 4), E('casi nada', 1)] }],                        // 200 sin ninguna ≥ 5 → []
  ['Pez Lento', 120, { tags: [E('Corriente Fría', 100)] }],
  ['Sal de Roca', 100, { tags: [E('Grano Grueso', 100), E('Salitre', 20)] }],
  ['Hilo Rojo', 80, { tags: [E('Nudo Suelto', 100)], artista: 'Hilo Rojo Oficial' }],        // autocorrect: otro nombre
  ['Vidrio Verde', 60, { tags: [E('Reflejo', 100)] }],
  ['Ola Quieta', 30, { tags: [E('Calma Chicha', 100)] }],
  ['Eco Bajo', 15, { tags: [E('Rebote', 100)] }],
];
const MENOS10 = [['Chispa', 5], ['Grano Fino', 9.9]];

export const HISTORIAL = {
  version: 3, generated_at: '2026-10-17T00:00:00Z',
  artists: Object.fromEntries([
    ...ARTISTAS.map(([n, min]) => [n, [tema('Tema de ' + n, min * 0.6), tema('Otro de ' + n, min * 0.4)]]),
    ...MENOS10.map(([n, min]) => [n, [tema('Único de ' + n, min)]]),
  ]),
  totals: Object.fromEntries([...ARTISTAS.map(([n, min]) => [n, T(min)]), ...MENOS10.map(([n, min]) => [n, T(min)])]),
};

// La cuenta hecha a mano, en décimas de minuto (filas, cinco desde v=314: con géneros · con etiquetas
// pero ninguna de género · Last.fm dice que no tiene · sin buscar todavía · menos de 10 min; cada una
// décimas y artistas). Las etiquetas inventadas son todas géneros para la regla de v=314.
//   total = 5000+4000+3000+2500+2000+1500+1200+1000+800+600+300+150 + 50+99 = 22199
//   al abrir: con géneros = Lumbre + Cassia = 9000 (2); sin buscar = el resto del universo,
//             22050 − 9000 = 13050 (10); menos de 10 = 149 (2).
//   al final: Tordo (no encontrado, 2000), Nube (sin ninguna ≥ 5, 1500) y, desde v=314, Hilo Rojo (el
//             autocorrect devolvió OTRO artista: lo de Last.fm no cuenta, 800) van a «no tiene» = 4300 (3);
//             con géneros = 22050 − 4300 = 17750 (9); sin buscar = 0.
//   (v=313, cuatro filas: abrir [9000, 0, 13050, 149] / [2, 0, 10, 2]; final [18550, 3500, 0, 149] /
//   [10, 2, 0, 2]: Hilo Rojo contaba «con etiquetas».)
export const ESPERADO = {
  total: 22199,
  universo: 12,
  abrir: { filas: [9000, 0, 0, 13050, 149], artistas: [2, 0, 0, 10, 2] },
  final: { filas: [17750, 0, 4300, 0, 149], artistas: [9, 0, 3, 0, 2] },
  // Los que se tienen que pedir, en el orden del universo: todos menos los dos ya buscados.
  pedidos: ARTISTAS.filter((a) => a[3] !== 'lastfm' && a[3] !== 'migrado').map((a) => a[0]),
  // Lo que tiene que quedar guardado en `fuentes.lastfm.tags` de cada uno (el filtro de siempre).
  guardado: Object.fromEntries(ARTISTAS.filter((a) => a[3] !== 'lastfm' && a[3] !== 'migrado').map(([n, , r]) => [
    n, r.error ? [] : r.tags.map((t) => ({ name: t.name.toLowerCase(), count: t.count })).filter((t) => t.count >= 5),
  ])),
};

/** Siembra el historial (inventado) en la clave del caché del owner. */
export async function sembrarHistorial(anclar) {
  const { OWNER_KEYS } = await import('/js/history-keys.js');
  const { idbSetCached } = await import('/js/idb.js');
  await anclar(idbSetCached(OWNER_KEYS.artistTracks, HISTORIAL, 100 * 365 * 24 * 60));
}

/** Siembra los tres registros del almacén de etiquetas (y la marca de migración, para no migrar nada). */
export async function sembrarEtiquetas(anclar, uid) {
  const { idbSetVarios } = await import('/js/idb.js');
  const G = await import('/js/util/generos-artista.js');
  const vacio = { migrado: null, lastfm: null, musicbrainz: null, statsfm: null };
  const fecha = Date.UTC(2026, 8, 1);
  const pares = [];
  for (const [n, , r, sembrado] of ARTISTAS) {
    if (!sembrado) continue;
    const k = n.toLowerCase();
    const tags = r.tags.map((t) => ({ name: t.name.toLowerCase(), count: t.count }));
    const fuentes = { ...vacio };
    if (sembrado === 'lastfm') fuentes.lastfm = { tags, fecha };
    else if (sembrado === 'migrado') fuentes.migrado = { tags, fecha };
    else fuentes.migrado = { tags: [], fecha };
    pares.push([G.claveGeneros(uid, k), { uid, nombre: k, fuentes }]);
  }
  pares.push([G.CLAVE_MIGRADO, { uid, fecha, entradas: 0 }]);
  await anclar(idbSetVarios(pares));
}

/**
 * El Last.fm de mentira. `responder(url, meta)` → `{status, cuerpo}`.
 *   · `fallo(n)`: la petición número n (global, de 1) contesta `{status: 200, error: 29}` o
 *     `{status: 503}` (lo que devuelva), o `null` para contestar bien;
 *   · `congelado = true`: lo que llegue se queda colgado (no contesta nunca);
 *   · `log`: cada petición con su número, marco, artista, estado, código y cabeceras.
 */
export function crearLastfm({ fallo = () => null } = {}) {
  const porNombre = Object.fromEntries(ARTISTAS.map((a) => [a[0], a]));
  // `abortadas`: las que el caso vio abortar con su señal (lo cuenta `generos-escaneo-caso.html`).
  const lf = { log: [], congelado: false, colgadas: 0, abortadas: 0, fallo };
  lf.responder = (url, meta = {}) => {
    const n = lf.log.length + 1;
    const u = new URL(url);
    const artista = u.searchParams.get('artist');
    const entrada = {
      n, url, artista, marco: meta.marco, metodo: meta.metodo || 'GET', cabeceras: meta.cabeceras || [],
      consulta: { method: u.searchParams.get('method'), autocorrect: u.searchParams.get('autocorrect'), format: u.searchParams.get('format') },
      status: null, codigo: null, definitiva: false,
    };
    lf.log.push(entrada);
    if (lf.congelado) { lf.colgadas++; entrada.status = 'colgada'; return new Promise(() => {}); }
    const f = lf.fallo(n);
    if (f === 29) { entrada.status = 200; entrada.codigo = 29; return Promise.resolve({ status: 200, cuerpo: JSON.stringify({ error: 29, message: 'banco: cuota de mentira' }) }); }
    if (f === 503) { entrada.status = 503; return Promise.resolve({ status: 503, cuerpo: '<html>banco: 503 de mentira</html>' }); }
    const a = porNombre[artista];
    const r = a ? a[2] : { error: 6 };
    entrada.status = 200;
    entrada.definitiva = true;
    if (r.error) { entrada.codigo = r.error; return Promise.resolve({ status: 200, cuerpo: JSON.stringify({ error: r.error, message: 'The artist you supplied could not be found', links: [] }) }); }
    return Promise.resolve({ status: 200, cuerpo: JSON.stringify({ toptags: { tag: r.tags, '@attr': { artist: r.artista || artista } } }) });
  };
  return lf;
}
