// tests/postal-anio.test.mjs — la postal del año: textos, recorte, posiciones y contraste (v=326, tanda 73)
//
// ═══════════════════════════════════════════════════════════════════════════
// QUÉ PROTEGE ESTE ARCHIVO
// ═══════════════════════════════════════════════════════════════════════════
//
// La postal es una imagen que circula SOLA: no lleva el ⓘ de la vista, ni el aviso del corte de los
// saltos, ni la posibilidad de abrir la ficha y ver de dónde sale un número. Lo que se equivoque ahí no
// lo corrige nadie. Por eso la parte que decide QUÉ dice y DÓNDE va (`src/js/util/postal-anio.js`) es pura
// y se prueba acá, en Node, con años INVENTADOS (2029, 2030, 2031: ningún número es de nadie):
//
//   1. el rango sale con `fmtDia` (el día que dice el dato): un año que arranca `…-01-01T00:00:28Z` dice
//      «1 ene», nunca «31 dic» — el bug de v=231, que en UTC−3 corre la primera escucha al año anterior.
//      Con `TZ` fijada a Buenos Aires: en una máquina en UTC el bug no se ve;
//   2. los números con `toLocaleString('es-ES')` (12.345 y 1234) y los minutos con el `fmtMinutes` QUE SE
//      LE PASA (uno de mentira acá): la postal no escribe su propio formateador;
//   3. 🔴 ningún texto dice «skip», «salt» ni lleva un porcentaje: antes del 15/10/2022 el export no anotaba
//      los saltos igual, y una imagen suelta no puede llevar el aviso;
//   4. el recorte con «…», con una medida de mentira (1 px por carácter): lo que entra no se toca, lo que
//      no entra termina en «…» y NUNCA pasa del máximo, y un nombre vacío no rompe;
//   5. con menos de 5 artistas o discos salen los que hay, sin filas vacías ni huecos;
//   6. ninguna caja se sale de 1080×1350 ni se pisa con otra;
//   7. el contraste del texto contra la caja donde va, en los cuatro `PRESETS`, ≥ 4,5:1 (la cuenta de
//      `tema-contraste.test.mjs`, la misma fórmula), y solo `--color-text` y `--color-text-secondary`.
//
// Contra v=325 da rojo porque el módulo no existe (y eso vale: es lo primero que se ve fallar).

process.env.TZ = 'America/Argentina/Buenos_Aires';

let ok = 0;
const fallos = [];
const af = (c, m) => { if (c) ok++; else fallos.push(m); };
const salir = () => {
  if (fallos.length) {
    console.error(`\n✗ postal-anio: ${fallos.length} fallo(s), ${ok} asserts ok\n`);
    for (const f of fallos) console.error('  · ' + f);
    process.exit(1);
  }
  console.log(`${ok} asserts OK`);
};

// El reloj de la máquina tiene que estar en UTC−3 para que el caso del 1 de enero muerda.
af(new Date('2031-01-01T00:00:28Z').getDate() === 31, 'la TZ de la prueba es UTC−3 (el 1 ene 00:00:28Z cae el 31 en local)');

// theme-panel.js importa DOM (modal-stack, toast…). Con este mínimo carga en Node: es el mismo andamio
// de `tema-contraste.test.mjs`, que lo único que necesita de él es `PRESETS`.
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } };
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  documentElement: { style: { setProperty() {}, removeProperty() {} } },
  body: {}, querySelector: () => null, getElementById: () => null,
};
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.window = globalThis;

const { PRESETS } = await import('../src/js/ui/theme-panel.js');
const { fmtDia } = await import('../src/js/util/fecha.js');
let P;
try {
  P = await import('../src/js/util/postal-anio.js');
} catch (e) {
  af(false, `src/js/util/postal-anio.js no carga: ${e.message}`);
  salir();
}
const { planPostal, textosPostal, recortar, avisoPostal, ANCHO, ALTO } = P;

// ── Los años INVENTADOS ─────────────────────────────────────────────────────
const fmtMentira = (m) => `MIN[${m}]`;
const porLetra = (t) => [...String(t)].length;           // 1 px por carácter
const ancha = (t) => [...String(t)].length * 20;         // 20 px por carácter: para que el recorte muerda en la postal
const IMG = (k) => `https://i.scdn.co/image/ab67616d0000b273${String(k).padStart(24, '0')}`;

function anio(over = {}) {
  return {
    year: 2031, min: 98765, plays: 12345, days_active: 1234, longest_streak: 12345,
    skip_pct: 41.7, skips: 999, plays_raw: 13000,
    first_play: '2031-01-01T00:00:28Z', last_play: '2031-12-31T01:10:00Z',
    peak_day: { date: '2031-03-09', min: 668 },
    top_artists: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `Artista inventado ${i}`, min: 1000 - i * 100, plays: 50 - i })),
    top_albums: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `Disco inventado ${i}`, artist: `Artista inventado ${i}`, min: 500 - i * 10, plays: 30 - i, img: IMG(i) })),
    ...over,
  };
}
const ctxMentira = { fmtMinutes: fmtMentira, fmtDia, medir: (t) => porLetra(t) };
const textos = (plan) => plan.textos.map((t) => t.texto);
const de = (plan, id) => plan.textos.find((t) => t.id === id);

// ── 1 · el rango, con fmtDia ────────────────────────────────────────────────
{
  const p = planPostal(anio(), ctxMentira);
  const r = de(p, 'rango')?.texto;
  af(r === 'del 1 ene 2031 al 31 dic 2031', `rango de un año que arranca 00:00:28Z y termina 01:10Z: «${r}»`);
  af(!textos(p).some((t) => /31 dic 2030|30 dic 2031/.test(t)), 'ningún texto corre el día a la hora local (ni «31 dic 2030» ni «30 dic 2031»)');
  af(de(p, 'anio')?.texto === '2031', 'el año, grande, tal cual');
  const medio = planPostal(anio({ year: 2029, first_play: '2029-08-15T14:00:00Z', last_play: '2029-12-31T20:00:00Z' }), ctxMentira);
  af(de(medio, 'rango')?.texto === 'del 15 ago 2029 al 31 dic 2029', `un año que empieza a mitad: «${de(medio, 'rango')?.texto}»`);
  const corto = planPostal(anio({ year: 2030, first_play: '2030-01-01T00:00:01Z', last_play: '2030-08-27T02:00:00Z' }), ctxMentira);
  af(de(corto, 'rango')?.texto === 'del 1 ene 2030 al 27 ago 2030', `un año que termina antes del 31/12: «${de(corto, 'rango')?.texto}»`);
  const pico = de(p, 'pico')?.texto;
  af(pico === 'Día pico: 9 mar 2031 · MIN[668]', `el día pico con fmtDia y sus minutos con el fmtMinutes pasado: «${pico}»`);
}

// ── 2 · los números, y los minutos con el fmtMinutes que se le pasa ─────────
{
  const p = planPostal(anio(), ctxMentira);
  const t = textos(p);
  af(de(p, 'cifra-minutos')?.texto === 'MIN[98765]', `los minutos del año salen del fmtMinutes pasado: «${de(p, 'cifra-minutos')?.texto}»`);
  af(de(p, 'cifra-reproducciones')?.texto === '12.345', `reproducciones con es-ES: «${de(p, 'cifra-reproducciones')?.texto}»`);
  af(de(p, 'cifra-dias')?.texto === '1234', `días con música con es-ES (cuatro cifras sin separador): «${de(p, 'cifra-dias')?.texto}»`);
  af(de(p, 'cifra-racha')?.texto === '12.345', `la racha con es-ES: «${de(p, 'cifra-racha')?.texto}»`);
  af(de(p, 'etiqueta-reproducciones')?.texto === 'reproducciones', 'la etiqueta: «reproducciones»');
  af(de(p, 'etiqueta-dias')?.texto === 'días con música', 'la etiqueta: «días con música»');
  af(/^días seguidos/.test(de(p, 'etiqueta-racha')?.texto || ''), `la etiqueta de la racha dice «días seguidos»: «${de(p, 'etiqueta-racha')?.texto}»`);
  for (let i = 0; i < 5; i++) {
    af(de(p, `artista-min-${i}`)?.texto === `MIN[${1000 - (i + 1) * 100}]`, `los minutos del artista ${i + 1} con el fmtMinutes pasado`);
  }
  af(!t.some((x) => /\d+h \d+m/.test(x)), 'ningún texto trae minutos con otro formateador («Nh Mm»)');
  const uno = planPostal(anio({ plays: 1, days_active: 1, longest_streak: 1 }), ctxMentira);
  af(de(uno, 'etiqueta-reproducciones')?.texto === 'reproducción' && de(uno, 'etiqueta-dias')?.texto === 'día con música' && /^día seguido/.test(de(uno, 'etiqueta-racha')?.texto || ''), 'en singular con 1: «reproducción», «día con música», «día seguido»');
  // `textosPostal` es lo mismo, sin posiciones: lo que usa `planPostal`.
  const tx = textosPostal(anio(), { fmtMinutes: fmtMentira, fmtDia });
  af(tx.rango === 'del 1 ene 2031 al 31 dic 2031' && tx.artistas.length === 5 && tx.discos.length === 5, 'textosPostal: el rango y cinco y cinco');
  af(tx.pie === 'Fonoteca' && de(p, 'pie')?.texto === 'Fonoteca', 'abajo, «Fonoteca»');
}

// ── 3 · sin saltos ──────────────────────────────────────────────────────────
{
  for (const y of [anio(), anio({ year: 2022 }), anio({ year: 2018, skip_pct: 64.2 })]) {
    const t = textos(planPostal(y, { fmtMinutes: (m) => `${m} min`, fmtDia, medir: porLetra }));
    af(!t.some((x) => /skip|salt|%/i.test(x)), `${y.year}: ningún texto dice «skip», «salt» ni lleva «%» (${t.filter((x) => /skip|salt|%/i.test(x)).join(' | ')})`);
  }
}

// ── 4 · el recorte, con 1 px por carácter ───────────────────────────────────
{
  af(recortar('abcde', 5, porLetra) === 'abcde', 'un texto que entra justo no se toca');
  af(recortar('abcd', 5, porLetra) === 'abcd', 'uno que sobra tampoco');
  const r = recortar('abcdef', 5, porLetra);
  af(r.endsWith('…') && porLetra(r) <= 5 && r === 'abcd…', `uno que no entra termina en «…» y no pasa del máximo: «${r}»`);
  af(recortar('', 5, porLetra) === '', 'un nombre vacío no rompe');
  af(recortar(null, 5, porLetra) === '' && recortar(undefined, 5, porLetra) === '', 'ni uno nulo');
  af(recortar('abc', 0, porLetra) === '', 'con máximo 0 no sale nada (ni el «…», que no entra)');
  af(recortar('abc', 1, porLetra) === '…', 'con máximo 1, solo el «…»');
  af(recortar('ab   cdef', 6, porLetra) === 'ab…', `no deja un espacio colgando antes del «…»: «${recortar('ab   cdef', 6, porLetra)}»`);
  af(recortar('🎵🎵🎵🎵', 3, porLetra) === '🎵🎵…', 'no parte un carácter de dos unidades por la mitad');
  // Barrido: ningún resultado pasa del máximo, con cualquier largo y cualquier medida.
  let pasa = 0, prob = 0;
  for (let n = 0; n < 40; n++) {
    const s = 'x'.repeat(n) + 'Ñandú inventado';
    for (let max = 0; max < 60; max++) {
      for (const medir of [porLetra, (t) => [...t].reduce((a, c) => a + (c === '…' ? 3 : c === 'x' ? 1 : 2), 0)]) {
        prob++;
        const r2 = recortar(s, max, medir);
        if (medir(r2) <= max && (medir(s) <= max ? r2 === s : (r2 === '' || r2.endsWith('…')))) pasa++;
      }
    }
  }
  af(pasa === prob, `barrido del recorte: ${pasa} de ${prob} dentro del máximo y con «…» cuando corta`);
  // En la postal: con 20 px por carácter el nombre largo se corta y ningún texto pasa de su caja.
  const largo = 'Orquesta Imaginaria de los Martes por la Tarde y Sus Amigos Ficticios del Barrio';
  const y = anio({ top_artists: [{ name: largo, min: 900, plays: 1 }, ...anio().top_artists.slice(1)], top_albums: [{ name: largo, artist: largo, min: 1, plays: 1, img: IMG(1) }] });
  const p = planPostal(y, { fmtMinutes: fmtMentira, fmtDia, medir: ancha });
  const a0 = de(p, 'artista-nombre-0');
  af(a0 && a0.texto.endsWith('…') && ancha(a0.texto) <= a0.max, `el nombre largo del artista termina en «…» y entra (${a0 && ancha(a0.texto)} ≤ ${a0?.max})`);
  af(de(p, 'disco-nombre-0')?.texto.endsWith('…') && de(p, 'disco-artista-0')?.texto.endsWith('…'), 'el nombre largo del disco y su artista también');
  const pasados = p.textos.filter((t) => ancha(t.texto) > t.max);
  af(pasados.length === 0, `ningún texto pasa de su máximo con 20 px por carácter: ${pasados.map((t) => t.id).join(', ')}`);
  const vacio = planPostal(anio({ top_artists: [{ name: '', min: 5, plays: 1 }], top_albums: [{ name: '', artist: '', min: 1, plays: 1 }] }), ctxMentira);
  af(de(vacio, 'artista-nombre-0')?.texto === '—' && de(vacio, 'disco-nombre-0')?.texto === '—', 'un artista o un disco sin nombre sale como «—», no como un hueco');
}

// ── 5 · menos de 5 ──────────────────────────────────────────────────────────
{
  const chico = anio({ top_artists: anio().top_artists.slice(0, 2), top_albums: anio().top_albums.slice(0, 3) });
  const p = planPostal(chico, ctxMentira);
  const nombres = p.textos.filter((t) => /^artista-nombre-/.test(t.id));
  af(nombres.length === 2, `con 2 artistas, 2 filas (${nombres.length})`);
  af(p.tapas.length === 3 && p.textos.filter((t) => /^disco-nombre-/.test(t.id)).length === 3, `con 3 discos, 3 tapas y 3 nombres (${p.tapas.length})`);
  af(!p.textos.some((t) => t.texto === ''), 'ningún texto vacío (ninguna fila sin nada)');
  const izq = p.tapas[0].x - p.fondos.find((f) => f.id === 'caja-discos').x;
  const der = (p.fondos.find((f) => f.id === 'caja-discos').x + p.fondos.find((f) => f.id === 'caja-discos').w) - (p.tapas.at(-1).x + p.tapas.at(-1).lado);
  af(Math.abs(izq - der) < 0.5, `las 3 tapas quedan centradas en su caja (${izq} a la izquierda, ${der} a la derecha)`);
  const sinDiscos = planPostal(anio({ top_albums: [] }), ctxMentira);
  af(sinDiscos.tapas.length === 0 && !de(sinDiscos, 'discos-titulo') && !sinDiscos.fondos.some((f) => f.id === 'caja-discos'), 'sin discos no hay caja de discos (ni un título sobre nada)');
  const sinNada = planPostal(anio({ top_albums: undefined, top_artists: undefined, peak_day: null }), ctxMentira);
  af(sinNada && de(sinNada, 'pico')?.texto === 'Día pico: —' && !de(sinNada, 'artistas-titulo'), 'sin listas ni día pico no revienta: «Día pico: —» y sin caja de artistas');
  const sinImg = planPostal(anio({ top_albums: [{ name: 'Disco sin tapa', artist: 'X', min: 1, plays: 1 }] }), ctxMentira);
  af(sinImg.tapas.length === 1 && sinImg.tapas[0].url === null, 'un disco sin `img` lleva url null (la vista le pone el ♪)');
}

// ── 6 · las posiciones ──────────────────────────────────────────────────────
function cajasDe(p) {
  return [
    ...p.textos.map((t) => ({ id: t.id, ...t.caja })),
    ...p.tapas.map((t) => ({ id: `tapa-${t.i}`, x: t.x, y: t.y, w: t.lado, h: t.lado })),
    ...p.barras.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h })),
  ];
}
const pisa = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
const dentro = (a, b) => a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.y + a.h <= b.y + b.h + 1e-6;
for (const [que, y, medir] of [
  ['el año entero', anio(), porLetra],
  ['con 20 px por carácter', anio(), ancha],
  ['2 artistas y 3 discos', anio({ top_artists: anio().top_artists.slice(0, 2), top_albums: anio().top_albums.slice(0, 3) }), ancha],
]) {
  const p = planPostal(y, { fmtMinutes: fmtMentira, fmtDia, medir });
  af(p.ancho === 1080 && p.alto === 1350 && ANCHO === 1080 && ALTO === 1350, `${que}: el lienzo es de 1080×1350`);
  const todas = [...cajasDe(p), ...p.fondos];
  const fuera = todas.filter((c) => c.x < 0 || c.y < 0 || c.x + c.w > 1080 || c.y + c.h > 1350 || !(c.w >= 0 && c.h > 0));
  af(fuera.length === 0, `${que}: ninguna caja se sale de 1080×1350 (${fuera.map((c) => c.id).join(', ')})`);
  const c = cajasDe(p);
  const pisadas = [];
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) if (pisa(c[i], c[j])) pisadas.push(`${c[i].id}×${c[j].id}`);
  af(pisadas.length === 0, `${que}: ningún texto, tapa ni barra se pisa con otro (${pisadas.join(', ')})`);
  const fp = [];
  for (let i = 0; i < p.fondos.length; i++) for (let j = i + 1; j < p.fondos.length; j++) if (pisa(p.fondos[i], p.fondos[j])) fp.push(`${p.fondos[i].id}×${p.fondos[j].id}`);
  af(fp.length === 0, `${que}: las cajas de fondo no se pisan (${fp.join(', ')})`);
  // Cada texto está donde dice que está: sobre una caja, dentro de ella; sobre el fondo, fuera de todas.
  const malSobre = p.textos.filter((t) => (t.sobre === 'bg' ? p.fondos.some((f) => pisa(t.caja, f)) : !p.fondos.some((f) => f.color === t.sobre && dentro(t.caja, f))));
  af(malSobre.length === 0, `${que}: cada texto está sobre el fondo que declara (${malSobre.map((t) => t.id).join(', ')})`);
  const tapasFuera = p.tapas.filter((t) => !p.fondos.some((f) => dentro({ x: t.x, y: t.y, w: t.lado, h: t.lado }, f)));
  af(tapasFuera.length === 0, `${que}: las tapas, dentro de su caja`);
  af(p.tapas.every((t) => t.nota && t.nota.texto === '♪' && t.nota.sobre === 'elevated'), `${que}: cada tapa trae su ♪ por si no baja (sobre --color-elevated)`);
}

// ── 7 · el contraste, en los cuatro presets ─────────────────────────────────
// La cuenta de WCAG 2.x, la MISMA de `tests/tema-contraste.test.mjs` (y de `mapa-mundo.test.mjs`): no
// es otra fórmula, es la de allá reusada. Los colores del tema son opacos: no hay alfa que componer.
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => {
  const [r, g, b] = rgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
{
  const TOKEN = { text: '--color-text', secondary: '--color-text-secondary', bg: '--color-bg', surface: '--color-surface', elevated: '--color-elevated' };
  const p = planPostal(anio(), ctxMentira);
  const pares = [...p.textos.map((t) => [t.id, t.color, t.sobre]), ...p.tapas.map((t) => [`nota-${t.i}`, t.nota.color, t.nota.sobre])];
  af(pares.every(([, c]) => c === 'text' || c === 'secondary'), `solo --color-text y --color-text-secondary para el texto (${[...new Set(pares.map(([, c]) => c))].join(', ')})`);
  af(p.fondos.every((f) => f.color === 'surface' || f.color === 'elevated'), 'las cajas, de --color-surface o --color-elevated');
  af(PRESETS.length === 4, `cuatro presets (${PRESETS.length})`);
  for (const pr of PRESETS) {
    const bajos = [];
    let min = Infinity;
    for (const [id, c, s] of pares) {
      const r = contraste(pr.colors[TOKEN[c]], pr.colors[TOKEN[s]]);
      min = Math.min(min, r);
      if (!(r >= 4.5)) bajos.push(`${id} ${r.toFixed(2)}`);
    }
    af(bajos.length === 0, `${pr.id}: todo el texto de la postal ≥ 4,5:1 contra su caja (mínimo ${min.toFixed(2)}): ${bajos.join(', ')}`);
  }
}

// ── 8 · la tapa, de 300 ─────────────────────────────────────────────────────
{
  const p = planPostal(anio(), ctxMentira);
  af(p.tapas.length === 5, 'cinco tapas');
  af(p.tapas.every((t, i) => t.url === IMG(i + 1).replace('ab67616d0000b273', 'ab67616d00001e02')), 'cada tapa pide la variante de 300 (`coverVariant`), sin ida a la API');
  af(p.tapas.every((t) => t.lado <= 300), 'el lado de la casilla no pide más que la variante de 300');
}

// ── 9 · el aviso del final ──────────────────────────────────────────────────
{
  af(avisoPostal({ faltan: 0 }) === 'Postal descargada.', 'sin faltantes: «Postal descargada.»');
  af(/\b2 tapas no se pudieron bajar\b/.test(avisoPostal({ faltan: 2 })) && avisoPostal({ faltan: 2 }).includes('♪'), `con 2 faltantes lo dice con el número: «${avisoPostal({ faltan: 2 })}»`);
  af(/\b1 tapa no se pudo bajar\b/.test(avisoPostal({ faltan: 1 })), 'con 1, en singular');
  const sin = avisoPostal({ sinTapas: true, motivo: 'SecurityError', faltan: 0 });
  af(sin.startsWith('La postal salió sin tapas: ') && sin.includes('SecurityError'), `sin tapas, lo dice con todas las letras y el motivo: «${sin}»`);
  af(![avisoPostal({}), avisoPostal({ faltan: 3 }), sin].some((x) => /\b(tenés|podés|acá)\b/.test(x)), 'el aviso, en castellano de España');
}

salir();
