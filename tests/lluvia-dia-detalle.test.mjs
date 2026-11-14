// Qué escuchaste los días de lluvia (v=368, tanda 131).
//
// ═══════════════════════════════════════════════════════════════════════════
// QUÉ VIGILA
// ═══════════════════════════════════════════════════════════════════════════
//
//  1. **El día local dentro del detalle.** `crearAcumuladorDeDias()` (REAL) devuelve, además de todo lo de
//     siempre, `diasLocal`: la misma forma que `dias`, agrupada por la fecha de `ts − 3 h` (Mar del Plata,
//     UTC−3 fija), con el MISMO diccionario `temas`. Los bordes contados a mano (`ESPERADO_LOCAL` de
//     `dobles/dias-t131-datos.mjs`). `DAYS_VERSION` en 2. El import completo trae el mismo `diasLocal`.
//  2. **`dias` y `temas` no cambian ni un byte**: su `sha256` (sin `generated_at`) es el de 9c7048e, medido
//     con las mismas reproducciones inventadas.
//  3. **La paridad con el horneado**: las mismas reproducciones por `gen-stats.py` (`main()` de verdad, con
//     `FONOTECA_OUT_DIR` a una carpeta temporal) y por el acumulador dan los mismos días locales y, día por
//     día, |diferencia| ≤ 0,1 min.
//  4. **Una sola implementación de las listas** (`ui/dia-escuchado.js`, REAL): `armarDia()` da lo mismo que
//     `datosDelDia()` de 9c7048e (sacada con `git show`), y **el panel de `#calendario` es byte a byte el de
//     9c7048e**: los tres `sha256` del HTML (un día con detalle, uno con minutos sin detalle, uno sin nada),
//     con el `calendario.js` REAL y los dobles de `dobles/loader-t110.mjs`.
//  5. **El panel de `#lluvia`** (`panelDelDia()` de `features/lluvia.js`, REAL): cada caso dice lo suyo, y con
//     un detalle viejo (sin `diasLocal`) nunca enseña `dias[iso]`, que es UTC.
//  6. **Las lecturas estáticas**: `lluvia.js` no arma listas por su cuenta ni lee `.dias[` del detalle;
//     `calendario.js` tampoco arma listas; ninguna `@media (prefers-reduced-motion)` nueva; `main.css` con
//     el mismo `sha256`.
//
// `RAIZ_T131=<carpeta>` lo corre contra otra copia (la de 9c7048e, para verlo en rojo). Corre sin red y sin
// navegador; escribe solo en una carpeta de `os.tmpdir()` que borra al terminar.
//
// Correr con: node tests/lluvia-dia-detalle.test.mjs
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = resolve(import.meta.dirname, '..');
const RAIZ = resolve(process.env.RAIZ_T131 || REPO);
const u = (p) => pathToFileURL(resolve(RAIZ, p)).href;
const BASE = '9c7048e';

let ok = 0;
const fallos = [];
const af = (c, m) => { if (c) ok++; else fallos.push(m); };
const igual = (a, b, m) => af(JSON.stringify(a) === JSON.stringify(b), `${m}: esperaba ${JSON.stringify(b)} y vino ${JSON.stringify(a)}`);
async function seccion(nombre, fn) {
  console.log(`\n[${nombre}]`);
  try { await fn(); } catch (e) { fallos.push(`${nombre}: tiró ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }
}

const D = await import('./dobles/dias-t131-datos.mjs');
const { sha256, panelesDeCalendario, crearElementoFalso } = await import('./dobles/panel-calendario-t131.mjs');

// Medidos contra 9c7048e (tmp-t131/salidas/02b-punto-de-partida.txt), con las reproducciones de arriba.
const SHA = {
  bordes: { dias: '6a62f6b828a3f06f9b86b4bf7ec45f751a7eacbf5b96db5a46d2e99f2e91120d', temas: '0a860db59045236e001667624b8213c5f6d4127017d1b7a6c64330f3db4ab92c' },
  todo: { dias: '9b57d10dc1495c6ccbb9560ac13a671bef086955e7bb26865f2bf81ade42b969', temas: '8ed03752a31e5c42eb674ceac684bf0197d03195879b55068d6d10fc727012b2' },
  // El HTML del panel de #calendario: 05/03 con detalle, 06/03 con minutos sin detalle, 07/03 sin nada.
  panel: [
    'fe8209b27acae432930a3f7d1d7d8a2055935f10e92ad84d885989f1e16c5a8d',
    'e35bc9c84c0197f90dbb2c6a227281b186878e5334359c4183bba623cef32018',
    '818a7f2d4b40b4e04e1be59e76d367d2fa3ccc6b470314fadba89af5ce328382',
  ],
  mainCss: '3f96a87858caf15a4fe6b67f2ba67a6430b6fc77083f4d2f5c25693849fecf07',
};

console.log(`raíz bajo prueba: ${RAIZ}`);

// El procesador ANTES del loader: así sus imports (junk, song-identity, corte-saltos) son los reales.
const hp = await import(u('src/js/history-processor.js'));
const acumular = (archivos) => { const a = hp.crearAcumuladorDeDias(); for (const x of archivos) a.agregarArchivo(x); return a.cerrar(); };
const idLegible = (d, i) => String(d.temas[i]?.[0] || '').replace('t131inventado', '');

// ═══════════════════════════════════════════════════════════════════════════
// 1 y 2 · el día local dentro del detalle; `dias` y `temas` intactos
// ═══════════════════════════════════════════════════════════════════════════
await seccion('1 · diasLocal', async () => {
  igual(hp.DAYS_VERSION, 2, 'DAYS_VERSION sube de 1 a 2');
  const d = acumular(D.BORDES);
  igual(d.version, 2, 'el payload lleva la versión 2');
  af(!!d.diasLocal && typeof d.diasLocal === 'object', 'cerrar() devuelve diasLocal');
  if (!d.diasLocal) return;
  igual(Object.keys(d), ['version', 'generated_at', 'temas', 'dias', 'diasLocal', 'conteo'], 'los campos: los de siempre, en su orden, y diasLocal detrás de dias');
  const legible = Object.fromEntries(Object.entries(d.diasLocal).map(([dia, v]) => [dia, { ...v, temas: v.temas.map(([i, m, n]) => [idLegible(d, i), m, n]) }]));
  igual(legible, D.ESPERADO_LOCAL, 'diasLocal entero = la cuenta a mano');
  igual(Object.keys(d.diasLocal), Object.keys(d.diasLocal).slice().sort(), 'los días locales, en orden');
  const t = (dia) => (legible[dia]?.temas || []).map((x) => x[0]);
  af(t('2024-03-09').includes('B') && !t('2024-03-10').includes('B'), '02:59:59Z va al día anterior');
  af(t('2024-03-10')[0] === 'C', '03:00:00Z va al mismo día');
  af(t('2024-12-31').includes('E') && !t('2025-01-01').includes('E'), 'el 1/1 a las 02:00Z va al 31/12 del año anterior');
  af(t('2024-03-11').includes('D') && t('2024-03-12').includes('D'), 'un tema a las 02:30Z y a las 04:00Z del mismo día UTC queda en DOS días locales');
  const dUtc = (d.dias['2024-03-12']?.temas || []).filter(([i]) => idLegible(d, i) === 'D');
  igual(dUtc.map((x) => x.slice(1)), [[4.5, 2]], 'y en UTC es un solo día, con las dos reproducciones');
  // Un diccionario, compartido.
  const indices = [...Object.values(d.dias), ...Object.values(d.diasLocal)].flatMap((x) => x.temas.map((y) => y[0]));
  af(indices.every((i) => Number.isInteger(i) && i >= 0 && i < d.temas.length), 'todos los índices de dias y de diasLocal apuntan al MISMO temas');
  igual(new Set(d.temas.map((x) => x[0])).size, d.temas.length, 'un tema vive una vez en el diccionario');
  // Las mismas reproducciones, otro corte: las sumas cuadran.
  const suma = (o, k) => Object.values(o).reduce((s, x) => s + x[k], 0);
  for (const k of ['crudas', 'validas', 'saltos']) igual(suma(d.diasLocal, k), suma(d.dias, k), `Σ ${k} local = Σ ${k} UTC`);
  const veces = (o) => Object.values(o).reduce((s, x) => s + x.temas.reduce((a, y) => a + y[2], 0), 0);
  igual(veces(d.diasLocal), veces(d.dias), 'Σ veces local = Σ veces UTC');
  igual(d.conteo, { leidas: 14, sin_uri: 1, repetidas: 1, ts_ilegible: 0 }, 'el conteo del import no cambió de forma ni de cuenta');
});

await seccion('2 · dias y temas, byte a byte los de 9c7048e', async () => {
  const b = acumular(D.BORDES);
  igual(sha256(JSON.stringify(b.dias)), SHA.bordes.dias, 'BORDES: sha256(dias)');
  igual(sha256(JSON.stringify(b.temas)), SHA.bordes.temas, 'BORDES: sha256(temas)');
  const todo = acumular([...D.BORDES, D.GENERADO]);
  igual(sha256(JSON.stringify(todo.dias)), SHA.todo.dias, 'BORDES+GENERADO: sha256(dias)');
  igual(sha256(JSON.stringify(todo.temas)), SHA.todo.temas, 'BORDES+GENERADO: sha256(temas)');
  // El import completo de un amigo usa el mismo acumulador por dentro: trae lo mismo.
  const completo = await hp.processStreamingHistory([...D.BORDES, D.GENERADO]);
  igual(completo.days?.diasLocal, todo.diasLocal, 'processStreamingHistory(): el mismo diasLocal');
  igual(completo.days?.dias, todo.dias, 'processStreamingHistory(): el mismo dias');
  igual(completo.days?.version, 2, 'processStreamingHistory(): versión 2');
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · la paridad con gen-stats.py
// ═══════════════════════════════════════════════════════════════════════════
const PY_MAIN = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location("gen_stats", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.MIN_ARCHIVOS_AUDIO = 1
m.plays_ya_horneadas = lambda: None
m.main()
`;
await seccion('3 · paridad con gen-stats.py', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 't131-paridad-'));
  try {
    const entrada = join(tmp, 'entrada'), salida = join(tmp, 'salida');
    mkdirSync(entrada); mkdirSync(salida);
    const archivos = [...D.BORDES, D.GENERADO];
    archivos.forEach((a, i) => writeFileSync(join(entrada, `Streaming_History_Audio_inventado_${i}.json`), JSON.stringify(a)));
    const env = { ...process.env, FONOTECA_HISTORY_DIR: entrada, FONOTECA_OUT_DIR: salida, PYTHONDONTWRITEBYTECODE: '1' };
    // gen-stats.py del REPO: no se toca en esta tanda, así que es el mismo en 9c7048e.
    const r = spawnSync('python3', ['-c', PY_MAIN, join(REPO, 'scripts/gen-stats.py')], { cwd: REPO, encoding: 'utf8', timeout: 120000, env });
    af(r.status === 0, `gen-stats.py main() salió con ${r.status}: ${(r.stderr || '').slice(-400)}`);
    const ruta = join(salida, 'history-days-local.json');
    af(existsSync(ruta), `emite history-days-local.json (emitió: ${existsSync(salida) ? readdirSync(salida).join(', ') : '—'})`);
    if (!existsSync(ruta)) return;
    const py = JSON.parse(readFileSync(ruta, 'utf8'));
    const local = acumular(archivos).diasLocal || {};
    const iso = (k) => new Date(Date.UTC(+py.from.slice(0, 4), +py.from.slice(5, 7) - 1, +py.from.slice(8, 10) + k)).toISOString().slice(0, 10);
    let dias = 0, maxDif = 0;
    const malos = [];
    py.min.forEach((m, k) => {
      const dia = iso(k), js = local[dia]?.min ?? 0;
      const dif = Math.abs(js - m);
      if (m > 0 || js > 0) dias++;
      if (dif > maxDif) maxDif = dif;
      if (dif > 0.1 + 1e-9) malos.push(`${dia}: py ${m} js ${js}`);
    });
    const pyConMin = new Set(py.min.map((m, k) => (m > 0 ? iso(k) : null)).filter(Boolean));
    const jsConMin = new Set(Object.entries(local).filter(([, v]) => v.min > 0).map(([k]) => k));
    igual([...jsConMin].sort(), [...pyConMin].sort(), 'los mismos días locales con minutos');
    af(malos.length === 0, `día por día, |diasLocal.min − min del JSON| ≤ 0,1 (${malos.slice(0, 5).join(' · ')})`);
    af(dias > 100, `la paridad mira más de 100 días (miró ${dias})`);
    console.log(`  paridad: ${dias} días locales con minutos, ${pyConMin.size} en el JSON, diferencia máxima ${maxDif.toFixed(3)} min`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · el módulo compartido y el panel de #calendario
// ═══════════════════════════════════════════════════════════════════════════
register(pathToFileURL(resolve(REPO, 'tests/dobles/loader-t110.mjs')).href, {
  data: { reales: ['/js/features/calendario.js', '/js/features/lluvia.js', '/js/ui/calendario-anual.js', '/js/util/fecha.js', '/js/util/lluvia.js', '/js/ui/components.js', '/js/ui/dia-escuchado.js'] },
});

await seccion('4a · armarDia() = datosDelDia() de 9c7048e', async () => {
  const g = spawnSync('git', ['-C', REPO, 'show', `${BASE}:src/js/features/calendario.js`], { encoding: 'utf8' });
  af(g.status === 0, `git show ${BASE}:src/js/features/calendario.js`);
  const m = (g.stdout || '').match(/function datosDelDia\(iso\) \{[\s\S]*?\n\}\n/);
  af(!!m, 'datosDelDia() está en el calendario.js de 9c7048e');
  if (!m) return;
  const vieja = (detalle) => new Function('detalle', 'anioElegido', 'tramoDe', 'aMs', `${m[0]}\nreturn datosDelDia;`)(
    detalle, 0, () => ({ days: { from: '2000-01-01', min: [] } }), (iso) => Date.parse(iso));
  const de = await import(u('src/js/ui/dia-escuchado.js'));
  let n = 0;
  for (const detalle of [acumular([...D.BORDES, D.GENERADO]), D.PANEL_DETALLE]) {
    const datosDelDia = vieja(detalle);
    for (const iso of Object.keys(detalle.dias)) {
      const v = datosDelDia(iso);
      const nuevo = de.armarDia(detalle.dias[iso], detalle.temas);
      if (JSON.stringify({ temas: v.temas, artistas: v.artistas }) !== JSON.stringify(nuevo)) fallos.push(`armarDia(${iso}) ≠ datosDelDia(${iso})`);
      else { ok++; n++; }
    }
  }
  console.log(`  ${n} días comparados`);
  igual(de.temasConVeces(de.armarDia(D.PANEL_DETALLE.dias['2024-03-05'], D.PANEL_DETALLE.temas).temas).map((x) => x.id),
    ['t131panelB', 't131panelA', 't131panelC'], 'temasConVeces() deja fuera el tema sin id y el de 0 veces, en el orden del día');
});

await seccion('4b · el panel de #calendario, byte a byte el de 9c7048e', async () => {
  const html = await panelesDeCalendario(u('src/js/features/calendario.js'), { stats: D.PANEL_STATS, detalle: D.PANEL_DETALLE, dias: D.PANEL_DIAS });
  D.PANEL_DIAS.forEach((iso, i) => igual(sha256(html[i]), SHA.panel[i], `panel de ${iso}: sha256`));
  af(html[0].includes('class="cal-lista cal-lista-art"') && html[0].includes('Tema &amp; &lt;Inventado&gt; Uno'), 'el día con detalle trae las dos listas, con el nombre escapado');
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · el panel de #lluvia, caso por caso
// ═══════════════════════════════════════════════════════════════════════════
await seccion('5 · el panel de #lluvia', async () => {
  // `escapeHtml()` (REAL) necesita `document.createElement`: el mismo `<div>` de mentira que el arnés del calendario.
  const docAntes = globalThis.document;
  globalThis.document = { createElement: crearElementoFalso };
  try { await panelDeLluvia(); } finally { globalThis.document = docAntes; }
});
async function panelDeLluvia() {
  const lluvia = await import(u('src/js/features/lluvia.js'));
  af(typeof lluvia.panelDelDia === 'function', 'lluvia.js exporta panelDelDia()');
  if (typeof lluvia.panelDelDia !== 'function') return;
  const nuevo = acumular(D.BORDES);
  const viejo = { version: 1, temas: nuevo.temas, dias: nuevo.dias };   // un detalle cargado antes de v=368
  const fila = (dia, minD, mmD = 123) => ({ dia, minD, mmD });
  const P = (f, det) => lluvia.panelDelDia(f, det);

  // Con el detalle y el día en diasLocal: las listas del día LOCAL (el 12/03 local tiene D y A; el UTC, D, E y A).
  const a = P(fila('2024-03-12', 31), nuevo);
  igual(a.caso, 'listas', 'con diasLocal: las listas');
  af(a.html.includes('Artistas del día') && a.html.includes('Temas del día'), 'con diasLocal: «Artistas del día» y «Temas del día»');
  af(a.html.includes('Tema Inventado D') && a.html.includes('Tema Inventado A') && !a.html.includes('Tema Inventado E'), 'con diasLocal: los temas del día LOCAL, no los del UTC');
  af(a.html.includes('12,3 mm · 3 min'), `la cabecera: «X mm · Y min», con Y de history-days-local (${(a.html.match(/lluvia-panel-sub[^>]*>([^<]*)/) || [])[1]})`);
  af(!/Crear playlist/.test(a.html), 'sin «Crear playlist con este día»');

  const b = P(fila('2024-03-12', 0), nuevo);
  igual(b.caso, 'nada', 'con 0 min: nada');
  af(b.html.includes('Ese día no sonó nada.') && !b.html.includes('cal-lista') && !b.html.includes('data-lluvia-cargar'), '0 min: «Ese día no sonó nada.» y nada más');

  const c = P(fila('2024-03-12', 31), viejo);
  igual(c.caso, 'version-anterior', 'detalle viejo: versión anterior');
  af(c.html.includes('Tu detalle por día se cargó con una versión anterior de la app y no sabe separar los días a la hora de Mar del Plata. Vuelve a cargarlo desde tu export para verlo aquí.'), 'detalle viejo: el texto');
  af(c.html.includes('data-lluvia-cargar') && c.html.includes('Cargar el detalle por día desde tu export'), 'detalle viejo: el botón');
  af(!c.html.includes('cal-lista') && !c.html.includes('Tema Inventado'), 'detalle viejo: NUNCA las listas de dias[iso] (UTC)');

  const s = P(fila('2024-03-12', 31), null);
  igual(s.caso, 'sin-detalle', 'sin detalle');
  af(s.html.includes('Qué sonó cada día vive solo en tu navegador y todavía no está cargado.') && s.html.includes('no se publica') && s.html.includes('data-lluvia-cargar'), 'sin detalle: el texto, la nota y el botón');

  const f = P(fila('2023-01-15', 50), nuevo);
  igual(f.caso, 'sin-dia', 'el día no está en diasLocal');
  af(f.html.includes('El detalle cargado no tiene este día: vuelve a cargarlo desde tu export.') && f.html.includes('data-lluvia-cargar') && !f.html.includes('cal-lista'), 'sin el día: lo dice, con el botón y sin listas vacías');
}

// ═══════════════════════════════════════════════════════════════════════════
// 6 · las lecturas estáticas
// ═══════════════════════════════════════════════════════════════════════════
await seccion('6 · lecturas estáticas', async () => {
  const leer = (p) => (existsSync(resolve(RAIZ, p)) ? readFileSync(resolve(RAIZ, p), 'utf8') : '');
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const ll = sinComentarios(leer('src/js/features/lluvia.js'));
  const cal = sinComentarios(leer('src/js/features/calendario.js'));
  af(/from '\.\.\/ui\/dia-escuchado\.js'/.test(ll), 'lluvia.js usa ui/dia-escuchado.js');
  af(/from '\.\.\/ui\/dia-escuchado\.js'/.test(cal), 'calendario.js usa ui/dia-escuchado.js');
  for (const [nombre, src] of [['lluvia.js', ll], ['calendario.js', cal]]) {
    af(!/cal-lista|cal-fila|porArtista|Artistas del día|Temas del día/.test(src), `${nombre} no arma las listas por su cuenta`);
  }
  af(!/\.dias\s*(\?\.)?\s*\[/.test(ll) && !/\bdias\s*\[\s*iso/.test(ll), 'lluvia.js nunca lee .dias[ del detalle');
  af(!/document\.querySelectorAll\(['"]\.cal-/.test(ll + cal), 'nadie barre .cal-… en todo el documento');

  // CSS: ninguna @media (prefers-reduced-motion) nueva, y main.css intacto.
  for (const hoja of ['theme.css', 'components.css', 'main.css']) {
    const g = spawnSync('git', ['-C', REPO, 'show', `${BASE}:src/css/${hoja}`], { encoding: 'utf8' });
    const cuenta = (s) => (s.match(/prefers-reduced-motion/g) || []).length;
    igual(cuenta(leer(`src/css/${hoja}`)), cuenta(g.stdout || ''), `${hoja}: las mismas prefers-reduced-motion que en 9c7048e`);
  }
  for (const js of ['features/lluvia.js', 'ui/dia-escuchado.js']) af(!/prefers-reduced-motion/.test(leer(`src/js/${js}`)), `${js} no mira prefers-reduced-motion`);
  igual(sha256(readFileSync(resolve(RAIZ, 'src/css/main.css'))), SHA.mainCss, 'main.css, el mismo sha256');
});

if (fallos.length) {
  console.error(`\n✗ lluvia-dia-detalle: ${fallos.length} fallo(s), ${ok} asserts ok\n`);
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}
console.log(`\n${ok} asserts`);
