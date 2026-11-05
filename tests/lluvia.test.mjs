// La cuenta de `#lluvia` (v=358, tanda 117): `util/lluvia.js`, con días INVENTADOS contados a mano.
//
// Y el JSON de la lluvia copiado de la tanda 116: la tabla por año que contó aquella tanda sale IGUAL
// de lo que quedó en `src/data/`, y el aviso y la atribución son los del JSON (la licencia CC BY pide
// el crédito).
//
// Corre con `TZ` de Buenos Aires y de Tokio: ninguna cuenta puede depender de la zona de la máquina.
// Correr con: node tests/lluvia.test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  decimas, esDiaDeLluvia, validarLluvia, diasLocalesValidos, filasDeLaVentana, media, mediana, resumir, porAnio,
  masLluviosos, lineaVentana, fraseDiferencia, FRASE_NO_CAUSA, textoMinutos, textoMm, textoPct, trozosAtribucion,
} = await import('../src/js/util/lluvia.js');
const { LLUVIA_VERSION, DAYS_LOCAL_VERSION, OWNER_KEYS } = await import('../src/js/history-keys.js');

let ok = 0;
const fallos = [];
const af = (c, m) => { if (c) ok++; else fallos.push(m); };
const igual = (a, b, m) => af(JSON.stringify(a) === JSON.stringify(b), `${m}: esperaba ${JSON.stringify(b)} y vino ${JSON.stringify(a)}`);
const tira = (fn, m) => { try { fn(); af(false, `${m}: no tiró`); } catch { ok++; } };

function casos() {
  // ── 1 · 1 mm, en décimas ──────────────────────────────────────────────────
  igual([0, 0.1, 0.9, 1, 1.1, 88.4].map(esDiaDeLluvia), [false, false, false, true, true, true], '0,9 no y 1,0 sí');
  igual(decimas(0.3), 3, '0,3 son 3 décimas, sin el error de coma flotante');
  igual(decimas(1.1), 11, '1,1 son 11 décimas');
  igual(decimas(4.35 + 0.05), 44, 'una suma de coma flotante redondea a décimas');

  // ── 2 · la ventana: sin el primero ni el último del historial ─────────────
  // Historial del 10 al 15 de marzo; lluvia del 1 al 31: la ventana es del 11 al 14.
  const lluviaMarzo = { desde: '2021-03-01', mm: Array.from({ length: 31 }, () => 0) };
  const hist = { from: '2021-03-10', min: [999, 10, 20, 30, 40, 999] };
  const f1 = filasDeLaVentana(hist, lluviaMarzo);
  igual(f1.map((f) => f.dia), ['2021-03-11', '2021-03-12', '2021-03-13', '2021-03-14'], 'sin el primero ni el último');
  af(f1.every((f) => f.minD !== 9990), 'los dos del borde no entran en ninguna cuenta');

  // La lluvia corta antes que el historial: el último del historial ya no importa.
  const f2 = filasDeLaVentana({ from: '2021-03-30', min: [1, 2, 3, 4, 5, 6] }, lluviaMarzo);
  igual(f2.map((f) => f.dia), ['2021-03-31'], 'la ventana termina con la lluvia');
  // La lluvia empieza después que el historial: el primero del historial ya no importa.
  const f3 = filasDeLaVentana({ from: '2021-02-25', min: Array.from({ length: 10 }, (_, i) => i) }, lluviaMarzo);
  igual(f3[0].dia, '2021-03-01', 'la ventana empieza con la lluvia');
  igual(f3[0].minD, 40, 'y el cruce es el del mismo día (25/02 + 4 = 01/03: 4 min)');
  igual(f3[f3.length - 1].dia, '2021-03-05', 'hasta el penúltimo del historial');
  // Sin solape, o con un historial de uno o dos días: nada.
  igual(filasDeLaVentana({ from: '2022-01-01', min: [1, 2, 3] }, lluviaMarzo), [], 'sin solape, 0 días');
  igual(filasDeLaVentana({ from: '2021-03-10', min: [1, 2] }, lluviaMarzo), [], 'con dos días de historial, 0 días');
  // Un día sin dato de lluvia no entra.
  const conHueco = { desde: '2021-03-01', mm: [1, null, 3, 4, 5] };
  igual(filasDeLaVentana({ from: '2021-02-28', min: [7, 7, 7, 7, 7, 7, 7] }, conHueco).map((f) => f.dia), ['2021-03-01', '2021-03-03', '2021-03-04', '2021-03-05'], 'un día con mm en null no entra');

  // ── 3 · el cruce: mm del mismo día, sin correr nada ───────────────────────
  // El día 12 llueve 1,0 y el 13, 0,9. Si el cruce se corriera un día, se cambiarían.
  const lluviaCorta = { desde: '2021-03-10', mm: [0, 0, 1, 0.9, 0, 0] };
  const f4 = filasDeLaVentana({ from: '2021-03-10', min: [5, 10, 20, 30, 40, 5] }, lluviaCorta);
  igual(f4.map((f) => [f.dia, f.minD, f.mmD, f.lluvia]), [
    ['2021-03-11', 100, 0, false],
    ['2021-03-12', 200, 10, true],
    ['2021-03-13', 300, 9, false],
    ['2021-03-14', 400, 0, false],
  ], 'cada día con sus minutos y sus mm');

  // ── 4 · la media y la mediana ─────────────────────────────────────────────
  igual(media([0, 0, 0, 100]), 25, 'la media incluye los días en 0');
  igual(media([1, 2]), 2, 'la media se redondea en décimas: 1,5 → 2');
  igual(media([]), null, 'sin días, la media es null, no 0');
  igual(mediana([30, 10, 20]), 20, 'la mediana con N impar, sin ordenar de entrada');
  igual(mediana([40, 10, 20, 30]), 25, 'la mediana con N par: el promedio de los dos del medio');
  igual(mediana([1, 2]), 2, 'la mediana par se redondea en décimas');
  igual(mediana([0, 0, 0, 100]), 0, 'la mediana con ceros');
  igual(mediana([]), null, 'sin días, la mediana es null');

  // ── 5 · los dos grupos ────────────────────────────────────────────────────
  // Con lluvia: 12/03 = 20 min. Sin: 10, 30, 40.
  const r = resumir(f4);
  igual(r.con, { dias: 1, conMusica: 1, pctD: 1000, mediaD: 200, medianaD: 200 }, 'el grupo con lluvia');
  igual(r.sin, { dias: 3, conMusica: 3, pctD: 1000, mediaD: 267, medianaD: 300 }, 'el grupo sin lluvia');
  const conCeros = resumir([
    { minD: 0, lluvia: true }, { minD: 0, lluvia: true }, { minD: 600, lluvia: true },
    { minD: 0, lluvia: false },
  ]);
  igual(conCeros.con, { dias: 3, conMusica: 1, pctD: 333, mediaD: 200, medianaD: 0 }, 'con ceros: sonó 1 de 3, media 20, mediana 0');
  igual(conCeros.sin, { dias: 1, conMusica: 0, pctD: 0, mediaD: 0, medianaD: 0 }, 'un grupo de días en 0');
  igual(resumir([{ minD: 5, lluvia: false }]).con, { dias: 0, conMusica: 0, pctD: null, mediaD: null, medianaD: null }, 'un grupo sin días no inventa ceros');

  // ── 6 · los textos ────────────────────────────────────────────────────────
  igual(textoPct(333), '33,3 %', 'el % con un decimal es-ES');
  igual(textoPct(1000), '100,0 %', 'el 100 también con su decimal');
  igual(textoPct(null), '—', 'sin dato, «—»');
  igual(textoMinutos(1234), '123', 'minutos sin decimales: 123,4 → 123');
  igual(textoMinutos(1235), '124', 'minutos sin decimales: 123,5 → 124');
  igual(textoMinutos(null), '—', 'sin dato, «—»');
  igual(textoMm(884), '88,4', 'mm con un decimal es-ES');
  igual(textoMm(10), '1,0', '1 mm, con su decimal');
  igual(lineaVentana([{ dia: '2018-08-15' }, { dia: '2026-10-21' }]), 'Del 15 ago 2018 al 21 oct 2026: 2 días. Un día con lluvia es uno con 1 mm o más.', 'la línea de arriba');

  // ── 7 · la frase, en sus tres textos ──────────────────────────────────────
  igual(fraseDiferencia(1500, 1200), 'Los días con lluvia escuchas de media 30 min más que los días sin lluvia.', 'más');
  igual(fraseDiferencia(1200, 1500), 'Los días con lluvia escuchas de media 30 min menos que los días sin lluvia.', 'menos');
  igual(fraseDiferencia(1200, 1204), 'Los días con lluvia escuchas lo mismo de media que los días sin lluvia.', 'lo mismo: 0,4 min redondea a 0');
  igual(fraseDiferencia(1204, 1200), 'Los días con lluvia escuchas lo mismo de media que los días sin lluvia.', 'lo mismo, del otro lado');
  igual(fraseDiferencia(1205, 1200), 'Los días con lluvia escuchas de media 1 min más que los días sin lluvia.', '0,5 min redondea a 1');
  igual(fraseDiferencia(1200, 1205), 'Los días con lluvia escuchas de media 1 min menos que los días sin lluvia.', 'y lo mismo en negativo (sin el -0 ni el redondeo asimétrico)');
  igual(fraseDiferencia(null, 1200), null, 'sin días con lluvia no hay frase');
  igual(FRASE_NO_CAUSA, 'Esto compara días: no dice que la lluvia sea la causa.', 'la frase de la causa');

  // ── 8 · los 10 más lluviosos ──────────────────────────────────────────────
  const dias12 = [
    ['2020-01-01', 50], ['2020-01-02', 120], ['2020-01-03', 120], ['2019-05-05', 120], ['2020-01-05', 10], ['2020-01-06', 30],
    ['2020-01-07', 40], ['2020-01-08', 60], ['2020-01-09', 70], ['2020-01-10', 80], ['2020-01-11', 90], ['2020-01-12', 5],
  ].map(([dia, mmD]) => ({ dia, mmD, minD: 1 }));
  const top = masLluviosos(dias12);
  igual(top.length, 10, 'como mucho 10');
  igual(top.slice(0, 3).map((f) => f.dia), ['2019-05-05', '2020-01-02', '2020-01-03'], 'un empate de tres: el más viejo primero');
  igual(top.map((f) => f.mmD), [120, 120, 120, 90, 80, 70, 60, 50, 40, 30], 'de más a menos');
  af(!top.some((f) => f.mmD === 10 || f.mmD === 5), 'los dos de menos mm se quedan fuera');
  af(dias12[0].dia === '2020-01-01', 'no reordena lo que recibe');

  // ── 9 · por año: el año LOCAL ─────────────────────────────────────────────
  // Del 30/12/2020 al 02/01/2021 (ventana). Con lluvia el 31 y el 02.
  const f5 = filasDeLaVentana({ from: '2020-12-29', min: [9, 10, 20, 30, 40, 9] }, { desde: '2020-12-29', mm: [0, 0, 2, 0, 3, 0] });
  igual(porAnio(f5), [
    { anio: 2020, diasConLluvia: 1, mediaConD: 200, mediaSinD: 100 },
    { anio: 2021, diasConLluvia: 1, mediaConD: 400, mediaSinD: 300 },
  ], 'cada año con sus días, en año local');
  igual(porAnio(f5.slice(0, 1)), [{ anio: 2020, diasConLluvia: 0, mediaConD: null, mediaSinD: 100 }], 'un año con un solo día va igual, y sin días con lluvia dice null');
  igual(porAnio([]), [], 'sin días, sin años');

  // ── 10 · las formas ───────────────────────────────────────────────────────
  af(diasLocalesValidos({ from: '2020-01-01', min: [] }), 'el historial local con su forma');
  af(!diasLocalesValidos({ from: '2020-01-01' }) && !diasLocalesValidos(null) && !diasLocalesValidos({ min: [] }), 'sin su forma, no');
  tira(() => validarLluvia({}), 'una lluvia vacía');
  tira(() => validarLluvia(null), 'null');
  tira(() => validarLluvia({ desde: '2020-01-01', mm: 'no' }), 'mm que no es lista');
}

for (const tz of ['America/Argentina/Buenos_Aires', 'Asia/Tokyo']) {
  process.env.TZ = tz;
  casos();
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. El JSON de la tanda 116, tal cual
// ═══════════════════════════════════════════════════════════════════════════
const crudo = readFileSync(join(raiz, 'src/data/lluvia-mar-del-plata.json'));
igual(crudo.length, 17806, 'los bytes del JSON de la lluvia');
igual(createHash('sha256').update(crudo).digest('hex'), '0a7908f6f62aa392781661b6756fd2a733d8f3076fcd489ea34318ee332c0d57', 'el sha256 de la tanda 116');
const L = validarLluvia(JSON.parse(crudo.toString('utf8')));
igual([L.version, L.desde, L.hasta, L.dias, L.utc_offset_seconds, L.zona_horaria], [1, '2018-01-01', '2026-11-02', 3228, -10800, 'America/Argentina/Buenos_Aires'], 'los campos');
igual(L.mm.length, 3228, 'un valor por día');

// La tabla de la 116: días · > 0 mm · ≥ 1 mm · total en décimas de mm.
const TABLA_116 = {
  2018: [365, 168, 106, 8139], 2019: [365, 154, 94, 7208], 2020: [366, 140, 90, 7891], 2021: [365, 165, 108, 9505], 2022: [365, 151, 86, 7729],
  2023: [365, 181, 112, 9032], 2024: [366, 170, 96, 7240], 2025: [365, 182, 105, 9516], 2026: [306, 159, 97, 8039],
};
const contada = {};
const t0 = Date.UTC(2018, 0, 1);
L.mm.forEach((mm, i) => {
  const y = new Date(t0 + i * 86400000).getUTCFullYear();
  const c = contada[y] ||= [0, 0, 0, 0];
  c[0]++;
  if (decimas(mm) > 0) c[1]++;
  if (esDiaDeLluvia(mm)) c[2]++;
  c[3] += decimas(mm);
});
igual(contada, TABLA_116, 'la tabla por año de la tanda 116 (las cuatro columnas, los nueve años)');
const totales = Object.values(contada).reduce((a, c) => a.map((x, i) => x + c[i]), [0, 0, 0, 0]);
igual(totales, [3228, 1470, 894, 74299], 'el total de la tabla');

// El aviso y la atribución son los del JSON, y el crédito se enseña sin los paréntesis con las URL.
igual(L.aviso, 'Lluvia estimada por un modelo meteorológico para la zona de Mar del Plata (reanálisis de Open-Meteo), no la medida del pluviómetro de la ciudad: un chaparrón local puede no figurar y un día puede salir con lluvia que en la ciudad no cayó.', 'el aviso');
igual(L.atribucion, 'Datos meteorológicos de Open-Meteo.com (https://open-meteo.com), licencia CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Reanálisis generado a partir de información del Copernicus Climate Change Service.', 'la atribución');
const trozos = trozosAtribucion(L.atribucion);
igual(trozos.map((t) => t.texto).join(''), L.atribucion.replace(/ \(https?:[^)]+\)/g, ''), 'el texto visible es la atribución sin los paréntesis con las URL');
igual(trozos.filter((t) => t.href), [
  { texto: 'Open-Meteo.com', href: 'https://open-meteo.com' },
  { texto: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' },
], 'y lleva los dos enlaces');

// La vista enseña lo del JSON: el fuente no trae su propia copia del crédito ni del aviso.
const fuente = readFileSync(join(raiz, 'src/js/features/lluvia.js'), 'utf8');
af(!fuente.includes('Copernicus') && !fuente.includes('pluviómetro'), 'features/lluvia.js no escribe el crédito ni el aviso a mano');
af(/escapeHtml\(lluvia\.aviso\)/.test(fuente) && /trozosAtribucion\(lluvia\.atribucion\)/.test(fuente), 'los lee del JSON');

// ═══════════════════════════════════════════════════════════════════════════
// 12. Las claves
// ═══════════════════════════════════════════════════════════════════════════
igual(DAYS_LOCAL_VERSION, 1, 'DAYS_LOCAL_VERSION');
igual(LLUVIA_VERSION, 1, 'LLUVIA_VERSION');
igual(OWNER_KEYS.daysLocal, 'history_days_local_v1', 'la clave del owner');
const historyData = readFileSync(join(raiz, 'src/js/features/history-data.js'), 'utf8');
af(/\n  daysLocal: \[\],\n/.test(historyData), 'OWNER_PREV_KEYS.daysLocal, vacía');
// `history-processor.js` (el import de un amigo) no produce el día local.
af(!/daysLocal|days-local/.test(readFileSync(join(raiz, 'src/js/history-processor.js'), 'utf8')), 'el import de un amigo no lo produce');

if (fallos.length) {
  console.error(`\n✗ lluvia: ${fallos.length} fallo(s), ${ok} asserts ok\n`);
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}
console.log(`${ok} asserts`);
