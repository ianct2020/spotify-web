// Los datos de mentira del banco `mapa.html` (v=304, tanda 52).
//
// 🔴 TODO INVENTADO: artistas, minutos, temas, ids de MusicBrainz y áreas. El
// repo es público y ningún dato de escucha de nadie entra acá.
//
// Doce artistas de 10 min o más —uno por cada caso de la regla— y dos de menos;
// desde v=305, dos más para el mundo (uno en Malta, que no tiene forma en el
// mapa, y uno con pocos minutos, para que se pinte un tono bajo).
// Desde v=307 (tanda 55), dos más para el alias de respaldo: uno que cambió de
// nombre (la búsqueda de siempre no lo encuentra y el respaldo sí, por su alias)
// y uno con un registro VIEJO en la caché (de v=304-306: `sin-candidato` y sin el
// campo `respaldo`), que la madre siembra antes de recargar.
// Lo que tiene que dar cada uno está escrito al lado, a mano, y `ESPERADO` lo
// junta: el banco compara la pantalla contra esta cuenta, no contra la del
// código que prueba.

const T = (min) => [Math.max(1, Math.round(min / 3)), min, 2021, 2025, [[2025, min, 1]], '2021-03-01'];
const tema = (titulo, min) => [titulo, 3, min, 'banco-' + titulo.toLowerCase().replace(/\W+/g, '-')];

export const AREA = {
  ciudad: 'b0000000-0000-4000-8000-000000000001',
  prov: 'b0000000-0000-4000-8000-000000000002',
  otra: 'b0000000-0000-4000-8000-000000000003',
};

// nombre, minutos, tema, candidatos de la búsqueda, ids de la grabación, lo esperado y (v=307, opcional)
// los candidatos del RESPALDO (`artist:"…" OR alias:"…"`); sin ellos, el respaldo contesta lo mismo que la búsqueda.
const C = (id, name, extra = {}) => ({ id, name, 'sort-name': name, score: 100, type: 'Person', ...extra });
export const ARTISTAS = [
  ['Lumbre Norte', 500, 'Brasa (Versión acústica)', [C('m-lumbre', 'Lumbre Norte', { country: 'AR' })], ['m-lumbre'], 'AR'],                         // unico corroborado
  ['Cassia Vento', 400, 'Maré', [C('m-cassia', 'Cassia Vento', { area: { id: AREA.ciudad, name: 'Ciudad Inventada', type: 'City' } })], ['m-cassia'], 'BR'], // país del área (2 saltos)
  ['Los Duendes del Faro', 300, 'Niebla', [C('m-duende1', 'Los Duendes del Faro', { country: 'ES' }), C('m-duende2', 'Los Duendes del Faro', { country: 'ES' })], null, 'ES'], // varios-mismo-pais
  ['Marea Gris', 250, 'Oleaje - Remix', [C('m-marea1', 'Marea Gris', { country: 'CL' }), C('m-marea2', 'Marea Gris', { country: 'MX' })], ['m-marea1'], 'CL'], // desempatado
  ['Tordo Azul', 200, 'Vuelo', [C('m-tordo', 'Tordo Azulado', { country: 'AR' })], null, 'sin-pais'],                                                   // sin-candidato
  ['Nube Baja', 150, 'Llovizna', [C('m-nube1', 'Nube Baja', { country: 'PE' }), C('m-nube2', 'Nube Baja', { country: 'UY' })], [], 'sin-pais'],      // ambiguo
  ['Pez Lento', 120, 'Corriente', [C('m-pez', 'Pez Lento', { country: 'AR' })], ['m-otro'], 'sin-confirmar'],                                            // unico sin corroborar
  ['Sal de Roca', 100, 'Grano', [C('m-sal', 'Sal de Roca', { area: { id: AREA.otra, name: 'Otra Ciudad', type: 'City' } })], ['m-sal'], 'BR'],         // área (la provincia ya está)
  ['Hilo Rojo', 80, 'Nudo', [C('m-hilo', 'Hilo Rojo')], null, 'sin-pais'],                                                                               // unico sin país ni área
  ['Vidrio Verde', 60, 'Reflejo', null, null, 'no-se-pudo'],                                                                                           // la búsqueda da 400
  ['Ola Quieta', 30, 'Calma', [C('m-ola', 'Ola Quieta', { country: 'AR' })], ['m-ola'], 'AR'],
  ['Eco Bajo', 15, 'Rebote', [C('m-eco1', 'Eco Bajo', { area: { id: AREA.ciudad, name: 'Ciudad Inventada', type: 'City' } }), C('m-eco2', 'Eco Bajo', { country: 'MX' })], ['m-eco1'], 'BR'], // desempatado, país del área
  // v=305 (tanda 53): los dos del mundo.
  ['Faro Maltés', 40, 'Bahía', [C('m-malta', 'Faro Maltés', { country: 'MT' })], ['m-malta'], 'MT'],                                                // Malta: con minutos y SIN forma en el mapa
  ['Brisa Sur', 12, 'Rambla', [C('m-brisa', 'Brisa Sur', { country: 'UY' })], ['m-brisa'], 'UY'],                                                   // pocos minutos: un tono bajo (2)
  // v=307 (tanda 55): el alias de respaldo.
  ['Coral Antiguo', 70, 'Arrecife', [C('m-coral-trib', 'Coral Antiguo Tributo')], ['m-coral'], 'PE',
    [C('m-coral-trib', 'Coral Antiguo Tributo'), C('m-coral', 'Coral Nuevo', { country: 'PE', aliases: [{ name: 'Coral Antiguo' }] })]],                 // renombrado: sin-candidato → el respaldo lo trae por su alias → PE
  ['Musgo Lento', 11, 'Humedad', [C('m-musgo-x', 'Musgo Lentísimo')], null, 'sin-pais', []],                                                         // registro VIEJO sembrado: solo pide el respaldo, que no trae a nadie
];
// El registro de v=304-306 que la madre siembra antes de recargar (sin el campo `respaldo`).
export const REGISTRO_VIEJO = { nombre: 'Musgo Lento', candidatos: [C('m-musgo-x', 'Musgo Lentísimo')] };
const MENOS10 = [['Chispa', 5], ['Grano Fino', 9.9]];

export const HISTORIAL = {
  version: 2, generated_at: '2026-10-14T00:00:00Z',
  artists: Object.fromEntries([
    ...ARTISTAS.map(([n, min, t]) => [n, [tema(t, min * 0.6), tema('Otro de ' + n, min * 0.4)]]),
    ...MENOS10.map(([n, min]) => [n, [tema('Único de ' + n, min)]]),
  ]),
  totals: Object.fromEntries([...ARTISTAS.map(([n, min]) => [n, T(min)]), ...MENOS10.map(([n, min]) => [n, T(min)])]),
};

// La cuenta hecha a mano, en décimas de minuto.
// v=307 (tanda 55): con Coral Antiguo (700, PE por el respaldo) y Musgo Lento (110,
// sin país) el total pasa de 22719 a 23529, el universo de 14 a 16, «con país» de
// 16470 a 17170, «sin país» de 4300 a 4410, los países de 6 a 7 (PE), las
// peticiones sin fallos de 27 a 32 (Tordo +1 respaldo; Coral búsqueda, respaldo y
// grabación; Musgo solo su respaldo) y los guardados de 13 a 15. Con el total
// nuevo, Chile baja de 11,0 a 10,6 % (sigue en el tono 5) y Perú (2,98 %) va en el 3.
// v=305 (tanda 53): con Faro Maltés (400) y Brisa Sur (120) el total pasa de
// 22199 a 22719, «con país» de 15950 a 16470, los países de 4 a 6, las
// peticiones sin fallos de 23 a 27, los guardados de 11 a 13 y el universo de 12
// a 14. Las otras cuatro filas no cambian.
export const ESPERADO = {
  total: 23529,
  universo: 16,
  filas: [
    5000 + 4000 + 3000 + 2500 + 1000 + 300 + 150 + 400 + 120 + 700,   // con país (+ Malta y Uruguay; + Perú, v=307)
    2000 + 1500 + 800 + 110,                        // sin país: Tordo, Nube, Hilo (+ Musgo, v=307)
    1200,                                           // sin confirmar: Pez
    600,                                            // sin buscar: Vidrio (no se pudo, no se guarda)
    50 + 99,                                        // menos de 10 min
  ],
  paises: [['AR', 5300, 2], ['BR', 5150, 3], ['ES', 3000, 1], ['CL', 2500, 1], ['PE', 700, 1], ['MT', 400, 1], ['UY', 120, 1]],
  // En el orden de la pantalla (el del escaneo: minutos descendente).
  sinPais: { 'Tordo Azul': 'sin-pais', 'Nube Baja': 'sin-pais', 'Pez Lento': 'sin-confirmar', 'Hilo Rojo': 'sin-pais', 'Musgo Lento': 'sin-pais' },
  // búsqueda + respaldo + áreas + grabación, sin fallos (Tordo 1 → 2 por su respaldo; Coral 3; Musgo 1).
  peticionesSinFallos: 2 + 4 + 1 + 2 + 2 + 2 + 2 + 3 + 1 + 1 + 2 + 2 + 2 + 2 + 3 + 1,
  artistasGuardados: 15,
  areasGuardadas: 3,
  // El mundo (v=305; v=307 sobre 23529 décimas), a mano, con los cortes fijos:
  //   AR 5300 → 22,5 % · BR 5150 → 21,9 % · ES 3000 → 12,8 % · CL 2500 → 10,6 %: los cuatro ≥ 10 % → 5;
  //   PE 700 → 2,98 % → 3 (v=307);
  //   MT 400 → 1,70 % → 3, pero no tiene forma: no se pinta, va en «No se ven»;
  //   UY 120 → 0,51 % → 2.
  // Pintados: los 7 de la lista menos Malta = 6. Todos los demás, «sin datos».
  tonos: { AR: 5, BR: 5, ES: 5, CL: 5, PE: 3, UY: 2 },
  sinForma: ['MT'],
  noSeVen: 'No se ven en el mapa: Malta',
};

const AREAS = {
  [AREA.ciudad]: { id: AREA.ciudad, name: 'Ciudad Inventada', type: 'City', 'iso-3166-1-codes': [], relations: [
    { type: 'part of', direction: 'backward', 'target-type': 'area', area: { id: AREA.prov, name: 'Provincia Inventada', type: 'Subdivision', 'iso-3166-2-codes': ['BR-ZZ'] } },
    { type: 'part of', direction: 'forward', 'target-type': 'area', area: { id: 'b0000000-0000-4000-8000-0000000000ff', name: 'Barrio Inventado', type: 'District' } },
  ] },
  [AREA.prov]: { id: AREA.prov, name: 'Provincia Inventada', type: 'Subdivision', 'iso-3166-2-codes': ['BR-ZZ'], relations: [
    { type: 'part of', direction: 'backward', 'target-type': 'area', area: { id: 'b0000000-0000-4000-8000-0000000000aa', name: 'Brasil', type: 'Country', 'iso-3166-1-codes': ['BR'] } },
    { type: 'part of', direction: 'forward', 'target-type': 'area', area: { id: AREA.ciudad, name: 'Ciudad Inventada', type: 'City' } },
  ] },
  [AREA.otra]: { id: AREA.otra, name: 'Otra Ciudad', type: 'City', relations: [
    { type: 'part of', direction: 'backward', 'target-type': 'area', area: { id: AREA.prov, name: 'Provincia Inventada', type: 'Subdivision' } },
  ] },
};

// ── Un historial sintético de N artistas (la medida del repintado) ───────────
const CODIGOS = ['AR', 'BR', 'CL', 'UY', 'PE', 'MX', 'ES', 'PT', 'FR', 'DE', 'IT', 'GB', 'IE', 'US', 'CA', 'AU', 'NZ', 'JP', 'KR', 'SE', 'NO', 'DK', 'FI', 'NL', 'BE', 'CH', 'AT', 'PL', 'CZ', 'HU', 'GR', 'TR', 'IL', 'ZA', 'NG', 'IN', 'CO', 'VE', 'EC', 'BO'];
export function historialSintetico(n) {
  const artists = {}, totals = {};
  for (let i = 0; i < n; i++) {
    const nombre = `Artista sintético ${String(i + 1).padStart(4, '0')}`;
    const min = Math.round((10 + (n - i) * 0.9) * 10) / 10;
    artists[nombre] = [tema('Tema ' + (i + 1), min)];
    totals[nombre] = T(min);
  }
  for (let i = 0; i < Math.round(n * 2); i++) totals[`Menor sintético ${i}`] = T(1 + (i % 9));
  return { version: 2, generated_at: '2026-10-14T00:00:00Z', artists, totals };
}

/** Siembra el historial (inventado) en la clave del caché del owner. */
export async function sembrarHistorial(anclar, hat = null) {
  const { OWNER_KEYS } = await import('/js/history-keys.js');
  const { idbSetCached } = await import('/js/idb.js');
  await anclar(idbSetCached(OWNER_KEYS.artistTracks, hat || HISTORIAL, 100 * 365 * 24 * 60));
}

/**
 * El MusicBrainz de mentira. `responder(url, meta)` → `{status, cuerpo}`.
 *   · `fallo503(n)`: la petición número n (global, de 1) contesta 503;
 *   · `congelado = true`: lo que llegue se queda colgado (no contesta nunca);
 *   · `log`: cada petición con su número, marco, tipo, estado y cabeceras.
 */
export function crearMB({ fallo503 = () => false, sintetico = 0 } = {}) {
  const porNombre = Object.fromEntries(ARTISTAS.map((a) => [a[0], a]));
  const mb = { log: [], congelado: false, colgadas: 0 };
  mb.responder = (url, meta = {}) => {
    const n = mb.log.length + 1;
    const u = new URL(url);
    // v=307: el respaldo es la misma ruta con otra consulta (el nombre O un alias).
    const respaldo = u.pathname === '/ws/2/artist/' && / OR alias:/.test(u.searchParams.get('query') || '');
    const tipo = u.pathname.startsWith('/ws/2/area/') ? 'area' : u.pathname === '/ws/2/recording/' ? 'grabacion' : respaldo ? 'respaldo' : u.pathname === '/ws/2/artist/' ? 'busqueda' : 'otra';
    const entrada = { n, url, tipo, marco: meta.marco, metodo: meta.metodo || 'GET', cabeceras: meta.cabeceras || [], status: null };
    mb.log.push(entrada);
    if (mb.congelado) { mb.colgadas++; entrada.status = 'colgada'; return new Promise(() => {}); }
    const r = contestar(u, tipo, n);
    entrada.status = r.status;
    return Promise.resolve(r);
  };
  function contestar(u, tipo, n) {
    const json = (o) => ({ status: 200, cuerpo: JSON.stringify(o) });
    if (fallo503(n)) return { status: 503, cuerpo: '{"error":"banco: 503 de mentira"}' };
    if (tipo === 'area') {
      const id = u.pathname.split('/').pop();
      return AREAS[id] ? json(AREAS[id]) : { status: 404, cuerpo: '{}' };
    }
    const q = u.searchParams.get('query') || '';
    if (tipo === 'respaldo') {
      const nombre = (q.match(/^artist:"(.*)" OR alias:"(.*)"$/) || [])[1]?.replace(/\\(.)/g, '$1');
      if (sintetico && /^Artista sintético/.test(nombre)) return json({ artists: [] });
      const a = porNombre[nombre];
      const lista = a ? (a[6] ?? a[3] ?? []) : [];
      return json({ artists: lista, count: lista.length, offset: 0 });
    }
    if (tipo === 'busqueda') {
      const nombre = (q.match(/^artist:"(.*)"$/) || [])[1]?.replace(/\\(.)/g, '$1');
      if (sintetico && /^Artista sintético/.test(nombre)) {
        const i = +nombre.slice(-4);
        if (i % 11 === 0) return json({ artists: [] });
        return json({ artists: [C('m-sint-' + i, nombre, { country: CODIGOS[i % CODIGOS.length] })] });
      }
      const a = porNombre[nombre];
      if (a && a[3] === null) return { status: 400, cuerpo: '{"error":"banco: consulta rara"}' };
      return json({ artists: a ? a[3] : [], count: a ? a[3].length : 0, offset: 0 });
    }
    if (tipo === 'grabacion') {
      const nombre = (q.match(/ AND artist:"(.*)"$/) || [])[1]?.replace(/\\(.)/g, '$1');
      if (sintetico && /^Artista sintético/.test(nombre)) {
        const i = +nombre.slice(-4);
        return json({ recordings: i % 7 === 0 ? [] : [{ 'artist-credit': [{ artist: { id: 'm-sint-' + i } }] }] });
      }
      const ids = porNombre[nombre]?.[4] || [];
      return json({ recordings: ids.map((id) => ({ id: 'r-' + id, title: 'x', 'artist-credit': [{ name: 'x', artist: { id } }] })) });
    }
    return { status: 404, cuerpo: '{}' };
  }
  return mb;
}
