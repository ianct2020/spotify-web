// Los datos de mentira del banco `generos.html` (v=314, tanda 62): la vista de géneros.
//
// 🔴 TODO INVENTADO: artistas, minutos, temas y etiquetas (salvo las genéricas de la regla: «canadian»,
// «female vocalists», «80s», «british», «usa», «my …»). El repo es público y ningún dato de escucha de
// nadie entra acá.
//
// Quince artistas de 10 min o más y tres de menos, con registros SEMBRADOS en el almacén de etiquetas que
// cubren lo que la regla tiene que decidir: géneros con basura al lado, dos formas de un sinónimo, solo
// no-géneros, «no tiene», el autocorrect a OTRO artista, lo migrado, y tres sin buscar (que el Last.fm de
// mentira contesta en la puerta D). v=320 (tanda 67): «Nube Fina» lleva su propio nombre como etiqueta, que no es un
// género (con v=319 salía «nube fina» en «Ver todos»: 14). Lo que tiene que dar está escrito A MANO en `ESPERADO`: el banco
// compara la pantalla contra esta cuenta, no contra la del código que prueba.

const T = (min) => [Math.max(1, Math.round(min / 3)), min, 2021, 2025, [[2025, min, 1]], '2021-03-01'];
const tema = (titulo, min) => [titulo, 3, min, 'banco-' + titulo.toLowerCase().replace(/\W+/g, '-')];
const E = (name, count = 100) => ({ name, count });

// nombre, minutos, lo sembrado (`{ lastfm: { tags, artista? } }` o `{ migrado: tags }`, o nada: sin buscar)
// y lo que contesta el Last.fm de mentira si se le pregunta.
export const ARTISTAS = [
  ['Faro Sur', 600, { lastfm: { tags: [E('Canadian'), E('Cumbia Lunar'), E('Female Vocalists', 60), E('Vals Sintético', 40), E('80s', 20), E('lote_inventado_3', 10)] } }], // géneros con basura
  ['Brisa Norte', 500, { lastfm: { tags: [E('Hip-Hop'), E('Rap', 70), E('Hip Hop', 30)] } }],    // dos formas de «hip hop»: cuenta una vez
  ['Cerro Alto', 400, { lastfm: { tags: [E('British'), E('Female Vocalists', 50)] } }],           // solo no-géneros
  ['Lago Quieto', 350, { lastfm: { tags: [] } }],                                                  // Last.fm dice que no tiene
  ['Hilo Doble', 300, { lastfm: { tags: [E('Cumbia Lunar'), E('Jota Eléctrica', 50)], artista: 'Otro Hilo Distinto' } }], // autocorrect a OTRO
  ['Valle Hondo', 250, null, { tags: [E('Cumbia Lunar'), E('Ola Nueva', 50)] }],                   // sin buscar (D)
  ['Río Lento', 200, { lastfm: { tags: [E('Cumbia Lunar'), E('Polka de Niebla', 50)] } }],
  ['Monte Gris', 180, { migrado: [E('rap'), E('trap marino', 60)] }],                              // lo migrado cuenta
  ['Duna Clara', 160, { lastfm: { tags: [E('Bolero Cósmico'), E('Synth Pop', 30)], artista: 'DUNA CLARA' } }], // autocorrect de mayúsculas: vale
  ['Isla Verde', 140, { lastfm: { tags: [E('Jota Eléctrica'), E('Tango de Faro', 80), E('USA', 20)] } }],
  ['Nube Fina', 120, { lastfm: { tags: [E('Salsa Polar'), E('Nube Fina', 50)] } }],               // v=320: su nombre no es un género
  ['Peña Roja', 100, { lastfm: { tags: [E('dnb'), E('Drum and Bass', 50)] } }],                    // dos formas de «drum and bass»
  ['Cala Azul', 80, null, { tags: [E('Ola Nueva')] }],                                             // sin buscar (D)
  ['Bahía Mansa', 50, { lastfm: { tags: [E('Ska Lunar'), E('My Lista Inventada', 50)] } }],
  ['Sierra Baja', 30, null, { tags: [E('Rap')] }],                                                 // sin buscar (D)
];
const MENOS10 = [['Chispa', 5, { lastfm: { tags: [E('Cumbia Lunar')] } }], ['Grano', 9.9], ['Polvo', 0.4]];

const historialDe = (artistas, menos10) => ({
  version: 3, generated_at: '2026-10-17T00:00:00Z',
  artists: Object.fromEntries([
    ...artistas.map(([n, min]) => [n, [tema('Tema de ' + n, min * 0.6), tema('Otro de ' + n, min * 0.4)]]),
    ...menos10.map(([n, min]) => [n, [tema('Único de ' + n, min)]]),
  ]),
  totals: Object.fromEntries([...artistas.map(([n, min]) => [n, T(min)]), ...menos10.map(([n, min]) => [n, T(min)])]),
});
export const HISTORIAL = historialDe(ARTISTAS, MENOS10);

// La cuenta hecha a mano, en décimas de minuto.
//   total = (600+500+400+350+300+250+200+180+160+140+120+100+80+50+30) × 10 + 50 + 99 + 4 = 34600 + 153 = 34753
//   Los géneros (cada artista suma sus minutos ENTEROS a cada uno; «Chispa» no está en el universo y no suma;
//   «Hilo Doble» tampoco: Last.fm devolvió otro artista):
//     cumbia lunar   = Faro Sur 600 + Río Lento 200   =  800 min (2)  →  8000/34753 = 23,0 %
//     rap            = Brisa Norte 500 + Monte Gris 180 = 680 (2)      →  19,6 %
//     vals sintético = Faro Sur 600 (1)                                →  17,3 %
//     hip hop        = Brisa Norte 500 (1: «hip-hop» y «hip hop» cuentan una vez) → 14,4 %
//     polka de niebla = 200 (1) → 5,8 % · trap marino = 180 (1) → 5,2 %
//     bolero cósmico = 160 (1) → 4,6 % · synthpop = 160 (1) → 4,6 %   (empate: va primero por nombre)
//     jota eléctrica = Isla Verde 140 (1) → 4,0 % · tango de faro = 140 (1) → 4,0 %
//     salsa polar = 120 (1) → 3,5 % · drum and bass = Peña Roja 100 (1) → 2,9 % · ska lunar = 50 (1) → 1,4 %
//   Las filas: con géneros = Faro, Brisa, Río, Monte, Duna, Isla, Nube, Peña, Bahía = 2050 min (9) → 20500;
//     con etiquetas, ninguna de género = Cerro Alto 4000 (1); no tiene = Lago Quieto + Hilo Doble = 6500 (2);
//     sin buscar = Valle + Cala + Sierra = 3600 (3); menos de 10 = 153 (3). 20500+4000+6500+3600+153 = 34753.
export const ESPERADO = {
  total: 34753,
  universo: 15,
  pendientes: 3,
  filas: [20500, 4000, 6500, 3600, 153],
  artistasFilas: [9, 1, 2, 3, 3],
  // [género, minutos, %, artistas (en orden)]
  generos: [
    ['cumbia lunar', '800 min', '23,0 %', ['Faro Sur', 'Río Lento']],
    ['rap', '680 min', '19,6 %', ['Brisa Norte', 'Monte Gris']],
    ['vals sintético', '600 min', '17,3 %', ['Faro Sur']],
    ['hip hop', '500 min', '14,4 %', ['Brisa Norte']],
    ['polka de niebla', '200 min', '5,8 %', ['Río Lento']],
    ['trap marino', '180 min', '5,2 %', ['Monte Gris']],
    ['bolero cósmico', '160 min', '4,6 %', ['Duna Clara']],
    ['synthpop', '160 min', '4,6 %', ['Duna Clara']],
    ['jota eléctrica', '140 min', '4,0 %', ['Isla Verde']],
    ['tango de faro', '140 min', '4,0 %', ['Isla Verde']],
    ['salsa polar', '120 min', '3,5 %', ['Nube Fina']],
    ['drum and bass', '100 min', '2,9 %', ['Peña Roja']],
    ['ska lunar', '50 min', '1,4 %', ['Bahía Mansa']],
  ],
  // Después de la búsqueda de la puerta D (Valle Hondo, Cala Azul y Sierra Baja contestan): cumbia lunar suma a
  // Valle Hondo (250) → 1050 min y 3 artistas; aparece «ola nueva» (Valle 250 + Cala 80 = 330 min, 2).
  despues: { cumbia: ['1050 min', 3], olaNueva: ['330 min', 2] },
};

// La puerta E: un género con más de 100 artistas (130, todos inventados), para «Mostrar 100 más».
export const GRANDE = Array.from({ length: 130 }, (_, i) => [`Masa ${String(i + 1).padStart(3, '0')}`, 200 - i, { lastfm: { tags: [E('Polka Masiva')] } }]);
export const HISTORIAL_GRANDE = historialDe(GRANDE, []);

/** Siembra un historial (inventado) en la clave del caché del owner. */
export async function sembrarHistorial(anclar, historial = HISTORIAL) {
  const { OWNER_KEYS } = await import('/js/history-keys.js');
  const { idbSetCached } = await import('/js/idb.js');
  await anclar(idbSetCached(OWNER_KEYS.artistTracks, historial, 100 * 365 * 24 * 60));
}

/** Siembra los registros del almacén de etiquetas (y la marca de migración, para no migrar nada). */
export async function sembrarEtiquetas(anclar, uid, artistas = [...ARTISTAS, ...MENOS10]) {
  const { idbSetVarios } = await import('/js/idb.js');
  const G = await import('/js/util/generos-artista.js');
  const vacio = { migrado: null, lastfm: null, musicbrainz: null, statsfm: null };
  const fecha = Date.UTC(2026, 8, 1);
  const bajar = (tags) => tags.map((t) => ({ name: t.name.toLowerCase(), count: t.count }));
  const pares = [];
  for (const [n, , s] of artistas) {
    if (!s) continue;
    const k = n.toLowerCase();
    const fuentes = { ...vacio };
    if (s.lastfm) fuentes.lastfm = { tags: bajar(s.lastfm.tags), fecha, ...(s.lastfm.artista ? { artista: s.lastfm.artista } : {}) };
    if (s.migrado) fuentes.migrado = { tags: bajar(s.migrado), fecha };
    pares.push([G.claveGeneros(uid, k), { uid, nombre: k, fuentes }]);
  }
  pares.push([G.CLAVE_MIGRADO, { uid, fecha, entradas: 0 }]);
  await anclar(idbSetVarios(pares));
}

/** El Last.fm de mentira: contesta a los tres sin buscar (con su `artista` = el pedido), y anota cada petición. */
export function crearLastfm() {
  const porNombre = Object.fromEntries(ARTISTAS.map((a) => [a[0], a[3]]));
  const lf = { log: [] };
  lf.responder = (url, meta = {}) => {
    const artista = new URL(url).searchParams.get('artist');
    lf.log.push({ n: lf.log.length + 1, artista, marco: meta.marco });
    const r = porNombre[artista];
    if (!r) return Promise.resolve({ status: 200, cuerpo: JSON.stringify({ error: 6, message: 'The artist you supplied could not be found', links: [] }) });
    return Promise.resolve({ status: 200, cuerpo: JSON.stringify({ toptags: { tag: r.tags, '@attr': { artist: artista } } }) });
  };
  return lf;
}
