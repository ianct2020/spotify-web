// La postal del año (v=326; rediseñada en v=327): QUÉ dice y DÓNDE va cada cosa. PURO: sin DOM, sin red
// y sin lienzo, para probarlo en Node (`tests/postal-anio.test.mjs`). El dibujo y la descarga viven en
// `features/wrapped-postal.js`, que le pasa la función de medir con la letra ya puesta.
//
// ── Por qué una postal POR AÑO ──────────────────────────────────────────────
//
// Ian pidió «pngs para exportar, con metricas o cosas interesantes» (16/10) y no dijo de qué. Que sea
// una por año, en «Wrapped», es NUESTRA lectura del pedido: `years[]` de `history-stats.json` ya trae
// todo lo que hace falta para los nueve años, y los cinco primeros discos de cada año tienen tapa. El
// artista no tiene foto en ningún JSON y el disco solo trae el día en que cumplió el umbral: esas
// postales quedan para otra tanda, si él las quiere.
//
// ── Lo que lleva, y lo que NO ───────────────────────────────────────────────
//
// El año, el rango («del 15 ago 2018 al 31 dic 2018»), los minutos (el número héroe), una franja con
// las reproducciones, los días con música, la racha más larga y el día pico, el artista más escuchado
// y los cuatro siguientes con sus barras, el disco más escuchado con su tapa grande y los cuatro
// siguientes con tapa chica, y abajo, «Fonoteca» y el año. Nada más.
//
//   · 🔴 Las fechas, con el `fmtDia` que se le pasa (el de `util/fecha.js`): lee los diez primeros
//     caracteres y no construye un `Date`. La primera escucha de 2026 es `2026-01-01T00:00:28Z`, y con
//     `new Date()` en UTC−3 la postal de 2026 diría «del 31 dic 2025» (el bug de v=231).
//   · Los minutos, con el `fmtMinutes` de `wrapped.js`, también pasado por contexto (como la apertura):
//     si se copiara acá, la copia es la que terminaría mintiendo (la lección de v=231).
//   · 🔴 Los saltos NO van, ni el porcentaje ni la palabra. Antes del 15/10/2022 el export no anotaba los
//     saltos igual que después (ver «La definición de salto» en CLAUDE.md), y en la vista eso lo avisa una
//     pista; una imagen que circula sola no puede llevar el aviso.
//
// ── El diseño (v=327) ───────────────────────────────────────────────────────
//
// La de v=326 se leía como una planilla: tres cajas de `--color-surface` iguales, una arriba de otra,
// todo con el mismo peso, y los nombres de disco mutilados en casillas de 160 px de un renglón. Ahora:
//
//   · una JERARQUÍA: lo primero que se lee es el año y los minutos, enormes, sobre un degradé del tema
//     (el acento mezclado con `--color-bg`, fuerte arriba y suave abajo, como el `.wrapped-hero` de la
//     tarjeta del año); el resto de los números baja a UNA franja de datos chicos;
//   · el artista 1 destacado a la izquierda (hasta dos renglones) y del 2 al 5 con sus barras;
//   · SIN cajas: las secciones las separan el espacio y los tamaños;
//   · el disco 1 es la imagen de la postal (380 px) y los otros cuatro van chicos al lado;
//   · los nombres de disco en hasta DOS renglones, partidos por palabra (`partir`), y el «…» solo si no
//     entran en dos.
//
// ── El degradé y su contraste ───────────────────────────────────────────────
//
// `degradadoPostal(plan, colores)` arma las paradas con el acento y el fondo del tema (ningún color a
// mano) y elige la mezcla: arranca en `MEZCLA_MAX` y la BAJA de a un centésimo hasta que cada texto que
// va encima tenga, contra el punto PEOR del degradé detrás de su caja (renglón por renglón, redondeado a
// 8 bits como lo pinta el lienzo), al menos `PISO_CONTRASTE`. Si ni con el fondo liso pasa (un tema
// hecho a mano con el texto ilegible), queda en 0: la postal no arregla el tema, no lo empeora. La
// cuenta es la de WCAG 2.x de `tests/tema-contraste.test.mjs`, la misma; el test la vuelve a hacer por
// su lado y compara.
//
// ── El recorte ──────────────────────────────────────────────────────────────
//
// Cada texto tiene un ancho máximo y se recorta con «…» MIDIENDO con la letra de verdad, nunca contando
// caracteres: «WWWW» y «iiii» no miden lo mismo. La medida entra inyectada.

import { coverVariant } from './album-key.js';

export const ANCHO = 1080;
export const ALTO = 1350;
/** Cuántos artistas y cuántos discos. */
export const TOPE = 5;
/** La variante de tapa que se pide (la casilla grande se agranda desde ésta: ×1,27). */
export const VARIANTE_TAPA = 300;
export const ELIPSIS = '…';

const MARGEN = 72;
const X0 = MARGEN;                 // donde empieza el contenido
const X1 = ANCHO - MARGEN;         // 1008: donde termina
/** El lado de la tapa del disco 1, la imagen de la postal. */
export const LADO_TAPA_1 = 380;
const CANAL = 40;                  // entre la columna de la izquierda y la de la derecha
const XD = X0 + LADO_TAPA_1 + CANAL;   // 492: la columna de la derecha
const ANCHO_DER = X1 - XD;             // 516
const SEP_TAPAS = 16;
/** El lado de las tapas de los discos 2 a 5: cuatro en la columna de la derecha. */
export const LADO_TAPA = Math.floor((ANCHO_DER - 3 * SEP_TAPAS) / 4);   // 117

// Las alturas, de arriba abajo. El degradé termina en Y_FIN_DEGRADE: todo lo que va encima es texto
// del bloque del año; la franja de datos ya va sobre el fondo liso.
const Y_ANIO = 60;
const Y_FIN_DEGRADE = 500;
const Y_DATOS = 530;
const Y_ARTISTAS = 664;
const Y_DISCOS = 876;
const Y_PIE = 1294;

// Las letras: peso y tamaño. La familia la pone quien dibuja (la de la app, `--font-sans`).
const F = {
  anio: { peso: 700, tam: 104 },
  rango: { peso: 400, tam: 30 },
  heroe: { peso: 700, tam: 156 },
  heroeEt: { peso: 400, tam: 32 },
  dato: { peso: 700, tam: 38 },
  datoEt: { peso: 400, tam: 21 },
  titulo: { peso: 600, tam: 21 },
  artista1: { peso: 700, tam: 40 },
  artista1Min: { peso: 400, tam: 26 },
  puesto: { peso: 600, tam: 24 },
  artista: { peso: 600, tam: 26 },
  artistaMin: { peso: 400, tam: 22 },
  disco1: { peso: 700, tam: 36 },
  disco1Artista: { peso: 400, tam: 26 },
  disco: { peso: 600, tam: 20 },
  discoArtista: { peso: 400, tam: 18 },
  pie: { peso: 600, tam: 22 },
};
/** Los pesos que usa la postal, para esperar a que cargue la letra antes de medir. */
export const PESOS = [...new Set([...Object.values(F).map((f) => f.peso), 400])].sort();

// El alto de la caja de un renglón: 1,25 veces el tamaño, con la línea de base arriba («top»), cabe la
// parte de abajo de la «g» y de la «p». Dos renglones van uno debajo del otro, a esa misma distancia.
const altoDe = (f) => Math.ceil(f.tam * 1.25);
// El año y los minutos son dígitos, «h», «m» y «—»: sin nada que baje de la línea. Su caja es más justa
// (0,95 veces el tamaño), si no queda un hueco de 70 px entre los minutos y «de música».
const altoJusto = (f) => Math.ceil(f.tam * 0.95);
const interlinea = altoDe;
const numero = (v) => Number(v || 0);
const plural = (n, uno, varios) => (n === 1 ? uno : varios);
// Un nombre vacío no deja un hueco: va «—».
const nombreDe = (s) => (String(s ?? '').trim() || '—');

/**
 * El texto recortado para que `medir(texto) ≤ max`. Si entra, tal cual; si no, el prefijo más largo que
 * entra con «…» (sin dejar un espacio colgando antes); si ni el «…» entra, cadena vacía. Parte por
 * caracteres de verdad (`Array.from`), no por unidades de UTF-16: un emoji no queda partido al medio.
 */
export function recortar(texto, max, medir) {
  const s = texto == null ? '' : String(texto);
  if (!s) return '';
  if (medir(s) <= max) return s;
  if (!(medir(ELIPSIS) <= max)) return '';
  const cs = Array.from(s);
  const con = (k) => cs.slice(0, k).join('').trimEnd() + ELIPSIS;
  // El prefijo más largo que entra, por bisección (cuanto más largo, más mide).
  let lo = 0, hi = cs.length - 1;
  while (lo < hi) {
    const k = Math.ceil((lo + hi) / 2);
    if (medir(con(k)) <= max) lo = k; else hi = k - 1;
  }
  return con(lo);
}

/**
 * El texto en hasta `renglones` renglones de `max` cada uno, partido por PALABRA. Si entra en uno, va
 * tal cual. Si no, el primer renglón lleva las palabras que entran (separadas por un espacio) y el
 * resto sigue en el siguiente; el último renglón se recorta con «…» (`recortar`) si no entra. Si ni la
 * primera palabra entra, se parte por caracteres (sin «…»: sigue en el renglón de abajo). Devuelve la
 * lista de renglones (vacía si no hay texto).
 */
export function partir(texto, max, medir, renglones = 2) {
  const s = texto == null ? '' : String(texto);
  if (!s) return [];
  if (renglones <= 1 || medir(s) <= max) {
    const r = recortar(s, max, medir);
    return r ? [r] : [];
  }
  const palabras = s.trim().split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];
  let k = 0;
  while (k < palabras.length && medir(palabras.slice(0, k + 1).join(' ')) <= max) k++;
  let primero, resto;
  if (k === 0) {
    const cs = Array.from(palabras[0]);
    let j = 0;
    while (j < cs.length && medir(cs.slice(0, j + 1).join('')) <= max) j++;
    if (j === 0) { const r = recortar(s, max, medir); return r ? [r] : []; }
    primero = cs.slice(0, j).join('');
    resto = [cs.slice(j).join(''), ...palabras.slice(1)].filter(Boolean).join(' ');
  } else {
    primero = palabras.slice(0, k).join(' ');
    resto = palabras.slice(k).join(' ');
  }
  if (!resto) return [primero];
  const siguen = partir(resto, max, medir, renglones - 1);
  // Si lo que sigue no entra de ninguna forma (ni el «…»), no se corta en silencio: el recorte de un
  // renglón, como con `recortar`.
  if (!siguen.length) { const r = recortar(s, max, medir); return r ? [r] : []; }
  return [primero, ...siguen];
}

/** Los textos de la postal de un año de `years[]`, sin posiciones. */
export function textosPostal(y, { fmtMinutes, fmtDia }) {
  const plays = numero(y.plays), dias = numero(y.days_active), racha = numero(y.longest_streak);
  const pico = y.peak_day?.date;
  return {
    anio: String(y.year),
    rango: `del ${fmtDia(y.first_play)} al ${fmtDia(y.last_play)}`,
    heroe: { valor: fmtMinutes(y.min), etiqueta: 'de música' },
    datos: [
      { id: 'reproducciones', valor: plays.toLocaleString('es-ES'), etiqueta: plural(plays, 'reproducción', 'reproducciones') },
      { id: 'dias', valor: dias.toLocaleString('es-ES'), etiqueta: plural(dias, 'día con música', 'días con música') },
      { id: 'racha', valor: `${racha.toLocaleString('es-ES')} ${plural(racha, 'día', 'días')}`, etiqueta: 'la racha más larga' },
      { id: 'pico', valor: pico ? fmtDia(pico) : '—', etiqueta: pico ? `día pico · ${fmtMinutes(y.peak_day.min)}` : 'día pico' },
    ],
    tituloArtistas: 'Artista más escuchado',
    artistas: (y.top_artists || []).slice(0, TOPE).map((a) => ({ nombre: nombreDe(a.name), minutos: fmtMinutes(a.min), min: numero(a.min) })),
    tituloDiscos: 'Disco más escuchado',
    // La tapa de 300 sale cambiando el prefijo de la URL, sin ida a la API (`coverVariant`). Sin `img`,
    // `null`: la casilla lleva el ♪, como una tapa que no bajó.
    discos: (y.top_albums || []).slice(0, TOPE).map((a) => ({ nombre: nombreDe(a.name), artista: nombreDe(a.artist), url: a.img ? coverVariant(a.img, VARIANTE_TAPA) : null })),
    pie: `Fonoteca · ${y.year}`,
  };
}

/**
 * La postal entera: qué se dibuja y dónde. `medir(texto, fuente)` devuelve el ancho en px con esa
 * fuente (`{ peso, tam }`). Coordenadas del lienzo de 1080×1350; los textos con la línea de base arriba.
 *
 * Devuelve `{ ancho, alto, degradado, fondos, barras, textos, tapas }`:
 *   · `degradado`: `{ y0, y1 }`, la franja de arriba que lleva el degradé (los colores los pone
 *     `degradadoPostal`, que depende del tema);
 *   · `fondos`: las cajas (desde v=327, ninguna; queda la forma para quien dibuja);
 *   · `barras`: lo que va con el acento (nunca texto), `{ id, x, y, w, h }`;
 *   · `textos`: `{ id, texto (ya recortado), x, y, max, alinear, fuente, alto, color: 'text'|'secondary',
 *     sobre: 'degradado'|'bg', caja: { x, y, w, h } }` — `caja` es el lugar que tiene reservado;
 *   · `tapas`: `{ id, i, url|null, x, y, lado, radio, nota }`, con `nota` = el ♪ por si la tapa no baja
 *     (sobre `--color-elevated`).
 */
export function planPostal(y, { fmtMinutes, fmtDia, medir }) {
  const tx = textosPostal(y, { fmtMinutes, fmtDia });
  const fondos = [], barras = [], textos = [], tapas = [];
  const poner = (id, texto, { x, y: yy, max, fuente, color, sobre, alinear = 'left', justo = false }) => {
    const alto = justo ? altoJusto(fuente) : altoDe(fuente);
    const cx = alinear === 'left' ? x : alinear === 'right' ? x - max : x - max / 2;
    const t = { id, texto: recortar(texto, max, (s) => medir(s, fuente)), x, y: yy, max, alinear, fuente, alto, color, sobre, caja: { x: cx, y: yy, w: max, h: alto } };
    textos.push(t);
    return t;
  };
  // Un nombre en hasta dos renglones: `id` el primero y `id-b` el segundo. Devuelve dónde termina.
  const ponerEnDos = (id, texto, { x, y: yy, max, fuente, color, sobre }) => {
    const rs = partir(texto, max, (s) => medir(s, fuente));
    rs.forEach((r, k) => poner(k ? `${id}-b` : id, r, { x, y: yy + k * interlinea(fuente), max, fuente, color, sobre }));
    return yy + (rs.length ? (rs.length - 1) * interlinea(fuente) + altoDe(fuente) : 0);
  };
  const sobreDeg = { color: 'text', sobre: 'degradado' };

  // ── El bloque del año, sobre el degradé: solo `--color-text` (el secundario no llega sobre el acento).
  poner('anio', tx.anio, { x: X0, y: Y_ANIO, max: X1 - X0, fuente: F.anio, justo: true, ...sobreDeg });
  const yRango = Y_ANIO + altoJusto(F.anio) + 12;
  poner('rango', tx.rango, { x: X0, y: yRango, max: X1 - X0, fuente: F.rango, ...sobreDeg });
  const yHeroe = yRango + altoDe(F.rango) + 30;
  poner('heroe', tx.heroe.valor, { x: X0, y: yHeroe, max: X1 - X0, fuente: F.heroe, justo: true, ...sobreDeg });
  poner('heroe-et', tx.heroe.etiqueta, { x: X0 + 4, y: yHeroe + altoJusto(F.heroe) + 6, max: X1 - X0 - 4, fuente: F.heroeEt, ...sobreDeg });

  // ── La franja de datos chicos: cuatro, en un renglón, separados por una línea del acento. Cada uno
  // mide lo que mide (el valor o la etiqueta, lo más ancho) y lo que sobra se reparte en los huecos; si
  // no entran con un hueco mínimo, van a partes iguales y se recortan.
  {
    const HUECO_MIN = 40;
    const n = tx.datos.length;
    let anchos = tx.datos.map((d) => Math.ceil(Math.max(medir(d.valor, F.dato), medir(d.etiqueta, F.datoEt))));
    const cabe = X1 - X0 - (n - 1) * HUECO_MIN;
    if (anchos.reduce((a, b) => a + b, 0) > cabe) anchos = anchos.map(() => Math.floor(cabe / n));
    const hueco = (X1 - X0 - anchos.reduce((a, b) => a + b, 0)) / (n - 1);
    let x = X0;
    tx.datos.forEach((d, k) => {
      poner(`dato-${d.id}`, d.valor, { x, y: Y_DATOS, max: anchos[k], fuente: F.dato, color: 'text', sobre: 'bg' });
      poner(`dato-${d.id}-et`, d.etiqueta, { x, y: Y_DATOS + altoDe(F.dato) + 2, max: anchos[k], fuente: F.datoEt, color: 'secondary', sobre: 'bg' });
      if (k < n - 1) barras.push({ id: `dato-sep-${k}`, x: Math.round(x + anchos[k] + hueco / 2 - 1), y: Y_DATOS + 6, w: 2, h: altoDe(F.dato) + altoDe(F.datoEt) - 10 });
      x += anchos[k] + hueco;
    });
  }

  // ── Los artistas: el 1 a la izquierda, grande, con su barra entera; del 2 al 5 a la derecha, con el
  // puesto, el nombre, los minutos y una barra con sus minutos contra los del primero.
  if (tx.artistas.length) {
    const a1 = tx.artistas[0];
    const tope = Math.max(...tx.artistas.map((a) => a.min));
    poner('artistas-titulo', tx.tituloArtistas, { x: X0, y: Y_ARTISTAS, max: LADO_TAPA_1, fuente: F.titulo, color: 'secondary', sobre: 'bg' });
    // El nombre del 1, como los de los discos, en hasta dos renglones: en uno, a este tamaño, casi
    // cualquier nombre de verdad se cortaba.
    const yM = ponerEnDos('artista-nombre-0', a1.nombre, { x: X0, y: Y_ARTISTAS + altoDe(F.titulo) + 6, max: LADO_TAPA_1, fuente: F.artista1, color: 'text', sobre: 'bg' }) + 2;
    poner('artista-min-0', a1.minutos, { x: X0, y: yM, max: LADO_TAPA_1, fuente: F.artista1Min, color: 'secondary', sobre: 'bg' });
    barras.push({ id: 'artista-barra-0', x: X0, y: yM + altoDe(F.artista1Min) + 8, w: LADO_TAPA_1, h: 8 });
    const resto = tx.artistas.slice(1);
    if (resto.length) {
      const anchoMin = Math.min(180, Math.ceil(Math.max(...resto.map((a) => medir(a.minutos, F.artistaMin)))));
      const xNombre = XD + 38;
      resto.forEach((a, j) => {
        const k = j + 1, yy = Y_ARTISTAS + j * 40;
        poner(`artista-puesto-${k}`, String(k + 1), { x: XD, y: yy + 2, max: 30, fuente: F.puesto, color: 'secondary', sobre: 'bg' });
        poner(`artista-nombre-${k}`, a.nombre, { x: xNombre, y: yy, max: X1 - anchoMin - 16 - xNombre, fuente: F.artista, color: 'text', sobre: 'bg' });
        poner(`artista-min-${k}`, a.minutos, { x: X1, y: yy + 4, max: anchoMin, fuente: F.artistaMin, color: 'secondary', sobre: 'bg', alinear: 'right' });
        barras.push({ id: `artista-barra-${k}`, x: xNombre, y: yy + 34, w: Math.max(2, Math.round((X1 - xNombre) * (tope > 0 ? a.min / tope : 0))), h: 4 });
      });
    }
  }

  // ── Los discos: el 1, la tapa grande a la izquierda y su nombre (hasta dos renglones) y su artista a
  // la derecha; del 2 al 5, tapas chicas en fila debajo, con el nombre (hasta dos renglones) y el
  // artista, nunca más anchos que su tapa. Con menos de cinco, los que hay, desde la izquierda.
  if (tx.discos.length) {
    const nota = (lado) => ({ texto: '♪', fuente: { peso: 400, tam: Math.round(lado * 0.4) }, color: 'secondary', sobre: 'elevated' });
    const d1 = tx.discos[0];
    tapas.push({ id: 'tapa-0', i: 0, url: d1.url, x: X0, y: Y_DISCOS, lado: LADO_TAPA_1, radio: 14, nota: nota(LADO_TAPA_1) });
    poner('discos-titulo', tx.tituloDiscos, { x: XD, y: Y_DISCOS, max: ANCHO_DER, fuente: F.titulo, color: 'secondary', sobre: 'bg' });
    const finNombre = ponerEnDos('disco-nombre-0', d1.nombre, { x: XD, y: Y_DISCOS + altoDe(F.titulo) + 6, max: ANCHO_DER, fuente: F.disco1, color: 'text', sobre: 'bg' });
    poner('disco-artista-0', d1.artista, { x: XD, y: finNombre + 2, max: ANCHO_DER, fuente: F.disco1Artista, color: 'secondary', sobre: 'bg' });
    // Las tapas chicas, para que su bloque entero (tapa, dos renglones y el artista) termine donde
    // termina la tapa grande.
    const yT = Y_DISCOS + LADO_TAPA_1 - (LADO_TAPA + 8 + interlinea(F.disco) + altoDe(F.disco) + 1 + altoDe(F.discoArtista));
    tx.discos.slice(1).forEach((d, j) => {
      const k = j + 1, x = XD + j * (LADO_TAPA + SEP_TAPAS);
      tapas.push({ id: `tapa-${k}`, i: k, url: d.url, x, y: yT, lado: LADO_TAPA, radio: 8, nota: nota(LADO_TAPA) });
      const fin = ponerEnDos(`disco-nombre-${k}`, d.nombre, { x, y: yT + LADO_TAPA + 8, max: LADO_TAPA, fuente: F.disco, color: 'text', sobre: 'bg' });
      poner(`disco-artista-${k}`, d.artista, { x, y: fin + 1, max: LADO_TAPA, fuente: F.discoArtista, color: 'secondary', sobre: 'bg' });
    });
  }

  poner('pie', tx.pie, { x: ANCHO / 2, y: Y_PIE, max: X1 - X0, fuente: F.pie, color: 'secondary', sobre: 'bg', alinear: 'center' });
  return { ancho: ANCHO, alto: ALTO, degradado: { y0: 0, y1: Y_FIN_DEGRADE }, fondos, barras, textos, tapas };
}

// ── El degradé ──────────────────────────────────────────────────────────────

/** La mezcla más fuerte del acento con el fondo, arriba de todo (0 = el fondo liso, 1 = el acento). */
export const MEZCLA_MAX = 0.6;
/** El contraste que tiene que dar el texto contra el punto peor del degradé. AA pide 4,5: un poco de
 *  margen por el redondeo y el difuminado del lienzo. */
export const PISO_CONTRASTE = 4.6;
// Las paradas: la mezcla entera arriba, un 40 % de ella a media altura y el fondo abajo.
const PARADAS = [{ t: 0, de: 1 }, { t: 0.55, de: 0.4 }, { t: 1, de: 0 }];

const rgbDe = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16));
const hexDe = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
// WCAG 2.x, la de `tests/tema-contraste.test.mjs`.
const lumDe = (h) => {
  const [r, g, b] = rgbDe(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrasteDe = (a, b) => { const x = lumDe(a), y = lumDe(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mezclar = (bg, acento, m) => { const a = rgbDe(bg), b = rgbDe(acento); return hexDe(a.map((v, i) => v + (b[i] - v) * m)); };

/** El color del degradé a la altura `y` (el centro del píxel), redondeado a 8 bits. */
function colorEn(paradas, y0, y1, y) {
  const t = Math.min(1, Math.max(0, (y + 0.5 - y0) / (y1 - y0)));
  let k = 0;
  while (k < paradas.length - 2 && t > paradas[k + 1].t) k++;
  const a = paradas[k], b = paradas[k + 1];
  const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  const ca = rgbDe(a.color), cb = rgbDe(b.color);
  return hexDe(ca.map((v, i) => v + (cb[i] - v) * u));
}

/**
 * Los colores del degradé para el tema `colores` (`{ bg, accent, text, secondary }`, en `#rrggbb`) y el
 * plan `plan`. Devuelve `{ y0, y1, mezcla, paradas: [{ t, color }], peor: [{ id, ratio, color, y }] }`:
 * `peor` es, para cada texto sobre el degradé, su contraste contra el punto peor de lo que tiene detrás.
 */
export function degradadoPostal(plan, colores) {
  const { y0, y1 } = plan.degradado;
  const zona = plan.textos.filter((t) => t.sobre === 'degradado' && t.texto);
  const medirCon = (paradas) => zona.map((t) => {
    let ratio = Infinity, color = null, donde = null;
    for (let yy = Math.floor(t.caja.y); yy < Math.ceil(t.caja.y + t.caja.h); yy++) {
      const c = colorEn(paradas, y0, y1, yy);
      const r = contrasteDe(colores[t.color], c);
      if (r < ratio) { ratio = r; color = c; donde = yy; }
    }
    return { id: t.id, ratio, color, y: donde };
  });
  for (let k = Math.round(MEZCLA_MAX * 100); k >= 0; k--) {
    const mezcla = k / 100;
    const paradas = PARADAS.map((p) => ({ t: p.t, color: mezclar(colores.bg, colores.accent, mezcla * p.de) }));
    const peor = medirCon(paradas);
    if (k === 0 || peor.every((p) => p.ratio >= PISO_CONTRASTE)) return { y0, y1, mezcla, paradas, peor };
  }
  return null;
}

/** El aviso de cuando termina: lo que la postal trae, sin vender de más. */
export function avisoPostal({ faltan = 0, sinTapas = false, motivo = null } = {}) {
  if (sinTapas) return `La postal salió sin tapas: el navegador no dejó exportarla con ellas (${motivo || 'sin motivo'}). Los discos van con su nombre y un ♪.`;
  if (faltan > 0) return `Postal descargada. ${faltan === 1 ? '1 tapa no se pudo bajar y va' : `${faltan} tapas no se pudieron bajar y van`} con ♪.`;
  return 'Postal descargada.';
}
