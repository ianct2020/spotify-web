// Suite del estimador de coste de escaneo (v=242).
//
// Lo que cuidan estas pruebas es el número que el aviso le muestra a Ian. Un
// aviso que dice «esto puede costar mucho» no sirve; el que dice «100
// peticiones» sí, pero solo si el 100 es correcto. Y cuidan el umbral por los
// dos lados: que no salte con un escaneo barato (un aviso que salta siempre se
// aprende a ignorar) y que sí salte con los dos casos caros conocidos.

import assert from 'node:assert';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./dobles/loader-costo.mjs', pathToFileURL(import.meta.filename));

const {
  estimarCostoDeEscaneo, superaUmbral, UMBRAL_AVISO, PAGINAS_POR_ARTISTA,
} = await import('../src/js/util/costo-escaneo.js');
const { PRESUPUESTO_REFRESCO, RECIENTE_TTL_MS, RECIENTE_FORZADO_MIN_MS } =
  await import('../src/js/util/disco-base.js');

let n = 0;
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };

const PREFIJO = 'discover_disco_base_v1_';
const DIA = 24 * 60 * 60 * 1000;

/** Prepara la IndexedDB falsa: bases con la edad que se pida, en días. */
function montarBases(edades) {
  const kv = new Map();
  edades.forEach((dias, i) => {
    kv.set(`${PREFIJO}a${i}`, { value: { items: [{ id: 'x' }], recienteAt: Date.now() - dias * DIA } });
  });
  globalThis.__IDB = { kv, ids: new Map() };
}

const artistas = (cuantos, desde = 0) =>
  Array.from({ length: cuantos }, (_, i) => ({ name: `A${desde + i}`, nameLower: `a${desde + i}`, seedId: `a${desde + i}` }));

// ── 1. El caso de hoy: base completa y fresca ──────────────────────────────
//
// Las 300 bases existen y ninguna pasó los 30 días. Abrir la vista no puede
// costar nada, y sobre todo no puede avisar de nada.

{
  montarBases(Array(300).fill(0));
  const est = await estimarCostoDeEscaneo(artistas(300));
  eq(est.total, 0, 'base completa y fresca: 0 peticiones');
  eq(est.sinBase, 0, 'no falta ninguna discografía');
  eq(est.exacto, true, 'sin artistas sin base, el número es exacto');
  eq(superaUmbral(est), false, 'y no avisa');
}

// ── 2. Puerta 1: «Actualizar» ──────────────────────────────────────────────
//
// Con `forzar`, el umbral baja de 30 días a 12 horas, así que las 300 bases
// frescas se vuelven candidatas igual. Es el gasto del enunciado: ~100
// peticiones de `/search` aunque no haya ni una vencida.

{
  // Las 300 reales del 25/09 tienen entre 0 y 22 días: por encima del piso de
  // 12 h del forzado, y muy por debajo del TTL de 30.
  montarBases(Array(300).fill(1));
  const est = await estimarCostoDeEscaneo(artistas(300), { forzar: true });
  eq(est.aRefrescar, PRESUPUESTO_REFRESCO, 'el refresco está topado por el presupuesto de la ronda');
  eq(est.pendientes, 300 - PRESUPUESTO_REFRESCO, 'y el resto queda para la próxima ronda');
  eq(est.total, PRESUPUESTO_REFRESCO, '«Actualizar» hoy: 100 peticiones');
  eq(est.sinBase, 0, 'sin pedir ninguna discografía entera');
  eq(est.exacto, true, 'una petición por discografía: exacto');
  eq(superaUmbral(est), true, 'y avisa');
}

// Sin `forzar`, esas mismas 300 bases frescas no cuestan nada. La diferencia
// entre las dos ramas es justo el bug del enunciado.
{
  montarBases(Array(300).fill(1));
  const est = await estimarCostoDeEscaneo(artistas(300), { forzar: false });
  eq(est.total, 0, 'sin forzar, esas mismas 300 bases de 1 día cuestan 0');
}

// El forzado respeta su propio piso de 12 h: dos clics seguidos no pagan dos
// veces. Una base mirada hace 1 hora no es candidata ni con `forzar`.
{
  montarBases([RECIENTE_FORZADO_MIN_MS / DIA / 2]);   // media ventana: ~6 h
  const est = await estimarCostoDeEscaneo(artistas(1), { forzar: true });
  eq(est.total, 0, 'mirada hace 6 h: ni forzando se vuelve a pedir');
}

// ── 3. Puerta 2: abrir la vista sin base ───────────────────────────────────
//
// El caso grave: `render()` termina en `scanArtists()`, o sea que abrir la
// vista escanea solo. Sin base, cada artista cuesta su discografía entera.

{
  globalThis.__IDB = { kv: new Map(), ids: new Map() };   // ni una base
  const est = await estimarCostoDeEscaneo(artistas(100));
  eq(est.sinBase, 100, 'los 100 sin base');
  eq(est.total, 100 * PAGINAS_POR_ARTISTA, '100 artistas sin base: 500 peticiones');
  eq(est.minimo, 100, 'el piso es 1 página por discografía');
  eq(est.exacto, false, 'con artistas sin base el número NO se puede saber exacto');
  eq(superaUmbral(est), true, 'y avisa');
}

// El TTL de 30 días, que es el caso del 03/10: 103 bases vencidas.
{
  montarBases([...Array(103).fill(31), ...Array(197).fill(0)]);
  const est = await estimarCostoDeEscaneo(artistas(300));
  eq(est.aRefrescar, 100, '103 vencidas, topadas en el presupuesto de 100');
  eq(est.total, 100, 'el pico del 03/10: 100 peticiones de búsqueda');
  eq(superaUmbral(est), true, 'y avisa');
}

// Una base justo por debajo del TTL no es candidata; justo por encima, sí.
{
  montarBases([RECIENTE_TTL_MS / DIA - 1]);
  eq((await estimarCostoDeEscaneo(artistas(1))).total, 0, 'a 29 días todavía no toca');
  montarBases([RECIENTE_TTL_MS / DIA + 1]);
  eq((await estimarCostoDeEscaneo(artistas(1))).total, 1, 'a 31 días toca, y cuesta 1');
}

// ── 4. El umbral, por los dos lados ────────────────────────────────────────
//
// Este es el equilibrio que decide si el aviso sirve o se vuelve ruido.

{
  // Sumar unos pocos artistas nuevos a los likes es lo normal, y tiene que
  // pasar callado: 7 artistas sin base son 35 peticiones, por debajo de 40.
  globalThis.__IDB = { kv: new Map(), ids: new Map() };
  const pocos = await estimarCostoDeEscaneo(artistas(7));
  eq(pocos.total, 35, '7 artistas nuevos: 35 peticiones');
  eq(superaUmbral(pocos), false, 'por debajo del umbral: no molesta');

  // El octavo cruza la línea.
  const ocho = await estimarCostoDeEscaneo(artistas(8));
  eq(ocho.total, 40, '8 artistas nuevos: 40 peticiones');
  eq(ocho.total >= UMBRAL_AVISO, true, 'justo en el umbral');
  eq(superaUmbral(ocho), true, 'y avisa');
}

// Una cola vacía no puede costar nada ni avisar de nada.
{
  globalThis.__IDB = { kv: new Map(), ids: new Map() };
  const est = await estimarCostoDeEscaneo([]);
  eq(est.total, 0, 'cola vacía: 0');
  eq(superaUmbral(est), false, 'y no avisa');
}

// ── 5. Artistas sin id: una búsqueda más cada uno ──────────────────────────
//
// Sin `seedId` y sin id cacheado hay que buscarlo antes de poder pedir nada:
// esa búsqueda también sale de la cuota compartida y tiene que estar contada.

{
  globalThis.__IDB = { kv: new Map(), ids: new Map() };
  const sinSeed = [{ name: 'X', nameLower: 'x', seedId: null }];
  const est = await estimarCostoDeEscaneo(sinSeed);
  eq(est.sinId, 1, 'el artista sin id está contado');
  eq(est.busquedas, 1, 'y cuesta una búsqueda');
  eq(est.total, 1 + PAGINAS_POR_ARTISTA, 'más su discografía entera');
}

// Con el id ya en la caché de 60 días, esa búsqueda no se paga.
{
  const kv = new Map([[`${PREFIJO}real`, { value: { items: [{ id: 'x' }], recienteAt: Date.now() } }]]);
  globalThis.__IDB = { kv, ids: new Map([['discover_artist_id_x', 'real']]) };
  const est = await estimarCostoDeEscaneo([{ name: 'X', nameLower: 'x', seedId: null }]);
  eq(est.sinId, 0, 'el id estaba cacheado: no se busca');
  eq(est.total, 0, 'y con su base fresca, no cuesta nada');
}

// ── 6. El desglose cuadra con el total ─────────────────────────────────────
//
// El aviso muestra las partes y la suma; si no cuadran, muestra una mentira.

{
  const kv = new Map();
  kv.set(`${PREFIJO}a0`, { value: { items: [{ id: 'x' }], recienteAt: Date.now() - 40 * DIA } });  // vencida
  kv.set(`${PREFIJO}a1`, { value: { items: [{ id: 'x' }], recienteAt: Date.now() } });             // fresca
  globalThis.__IDB = { kv, ids: new Map() };
  const est = await estimarCostoDeEscaneo(artistas(4));   // a0, a1 con base; a2, a3 sin
  eq(est.sinBase, 2, 'dos sin base');
  eq(est.aRefrescar, 1, 'una vencida');
  eq(est.nativos, 2 * PAGINAS_POR_ARTISTA, 'las dos discografías enteras');
  eq(est.busquedas, 1, 'y la búsqueda del refresco');
  eq(est.total, est.nativos + est.busquedas, 'el total es la suma de las partes');
  eq(est.artistas, 4, 'y los artistas son los de la cola');
}

console.log(`OK costo-escaneo: ${n} asserts`);
