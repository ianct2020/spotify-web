// Apertura del Wrapped (v=216): un recorrido de pantallas clavadas que se
// scrollea ANTES del Wrapped de siempre.
//
// ═══════════════════════════════════════════════════════════════════════════
// LA REGLA DURA: si la apertura falla, el Wrapped de abajo queda ENTERO.
// ═══════════════════════════════════════════════════════════════════════════
//
// Y se garantiza por estructura, en tres capas, ninguna de las cuales depende
// de acordarse de nada al escribir código nuevo:
//
//   1. Este módulo se carga con `import()` DINÁMICO desde `wrapped.js`, y
//      recién DESPUÉS de que `renderYearCard()` y `renderAllTime()` hayan
//      pintado el Wrapped completo. Si el archivo no está desplegado, si tira
//      al evaluarse o si `montarApertura()` revienta, lo único que pasa es que
//      el hueco de la apertura se queda vacío y se borra. Con un `import`
//      estático NO sería así: un módulo que no carga se lleva puesto a
//      `wrapped.js` entero, y con él la vista.
//      ⚠️ `build.sh` versiona los `import(...)` dinámicos igual que los
//      estáticos — se agregó en v=216 justo por esto. Sin eso el navegador
//      podría servir una versión vieja de este archivo después de un bump.
//
//   2. El CSS no esconde nada. `.wr-ap` sin la clase `.js` es una lista de
//      paneles uno debajo del otro, legibles, con los gráficos en su estado
//      final y los números escritos. La clase `.js` la pone este módulo recién
//      cuando ya armó el IntersectionObserver y sabe que puede.
//
//   3. Con las animaciones apagadas (`animationsEnabled()` en `ui/reveal.js`)
//      la apertura ni siquiera se clava: queda esa misma lista compacta y
//      quieta. No es un modo degradado escondido, es el mismo camino que el
//      fallo, así que se prueba cada vez que alguien apaga el toggle.
//
// ───────────────────────────────────────────────────────────────────────────
// POR QUÉ LOS FORMATEADORES LLEGAN POR PARÁMETRO
//
// `fmtMinutes` y `daysCovered` viven en `features/wrapped.js` y se pasan en
// `ctx`; `fmtDia` viene de `util/fecha.js` y llega por el mismo camino.
// Copiarlos acá sería reintroducir el bug de las fechas por la puerta de atrás,
// y no es hipotético: `wrapped.js` tenía su propia copia del formateo —la
// `fmtDate()` de v=154— y fue la copia la que enseñó «31 dic 2025» en la
// baldosa de 2026 durante 27 versiones. Lo mismo con `daysCovered`, que es el
// denominador que la baldosa «Días activos» ya muestra: el calendario de acá
// tiene que contar exactamente los mismos días o dice otra cosa que la tarjeta
// que tiene debajo.
//
// ───────────────────────────────────────────────────────────────────────────
// CUÁNTOS PASOS Y POR QUÉ
//
// Hasta seis, y el criterio es uno solo: **un dato se gana una pantalla si
// necesita un dibujo para entenderse, o si es una comparación que la grilla de
// abajo no puede hacer.** El dato suelto que se lee de un vistazo se queda de
// baldosa, que es donde además se compara con las de al lado.
//
//   1 · las horas          el titular. El único sin dibujo: el dibujo es el
//                          tamaño del número.
//   2 · el año mes a mes   la CURVA es el dato. «Mes pico: abril» no cuenta
//                          que llevas cuatro meses bajando.
//   3 · artista del año    la DISTANCIA es el dato: cuánto le saca al segundo
//                          y si hay podio o hay un primero y un pelotón.
//   4 · álbum del año      la TAPA. Es la única imagen del año y en la baldosa
//                          entra a 92 px.
//   5 · los días           CUÁNDO paraste. La baldosa da 232 de 239; el
//                          calendario dice en qué semanas están los huecos.
//   6 · el año dentro de   la grilla mira UN AÑO POR VEZ. Este dato no existe
//       todo tu historial  en ninguna de sus baldosas.
//
// Se quedan de baldosa: track del año, descubrimiento, día más largo, primera
// play, mes pico y skips.
//
// Los seis son CONDICIONALES: cada paso se construye solo si su dato está. Un
// año con dos meses de datos no dibuja la curva, un año sin `days` (historial
// propio subido con un pipeline viejo) no dibuja el calendario, y el año más
// antiguo de alguien con un solo año de datos no tiene contra qué compararse.
// Con menos de dos pasos la apertura no se monta: no hay recorrido que hacer.

import { animationsEnabled } from '../ui/reveal.js?v=235';

// ── un solo recorrido vivo por vez ──────────────────────────────────────────
//
// Cambiar de año con los chips llama a `render()`, que repinta todo. Sin esto
// quedaría un IntersectionObserver por cada click agarrando nodos muertos —el
// mismo motivo por el que `renderYearCard()` llama a `releaseReveal()`— y los
// `requestAnimationFrame` de los contadores seguirían escribiendo en paneles
// que ya no están en el documento.
let vivo = null;

function destruirVivo() {
  if (!vivo) return;
  try { vivo.destruir(); } catch { /* ya estaba a medio morir */ }
  vivo = null;
}

// Salir de la vista con la apertura a medias. `routeteardown` lo dispara el
// router ANTES del teardown de la ruta (router.js:109), así que llega siempre,
// incluso si la vista se fue por un error.
try {
  document.addEventListener('routeteardown', destruirVivo);
} catch { /* sin document no hay nada que limpiar */ }

const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// ── utilidades de fecha, todas en UTC ───────────────────────────────────────
//
// Un "YYYY-MM-DD" es un DÍA del calendario, no un instante: pasarlo por
// `new Date()` lo pone a medianoche UTC y leerlo en local lo corre un día para
// atrás en cualquier huso negativo. Es el bug de v=154. Acá nunca se sale de
// UTC: se entra con `Date.UTC` y se lee con `getUTC*`.
function aMs(iso) {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
}
function isoDesde(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
/** 0 = lunes, igual que `weekday()` de Python y que el heatmap del pipeline. */
function diaSemanaLunes(iso) {
  return (new Date(aMs(iso)).getUTCDay() + 6) % 7;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function num(n) {
  return Number(n).toLocaleString('es-ES');
}
function pct(v) {
  return v.toFixed(1).replace('.', ',') + '%';
}
function coma(v, dec = 1) {
  return v.toFixed(dec).replace('.', ',');
}

// ═══════════════════════════════════════════════════════════════════════════
// LOS PASOS
// ═══════════════════════════════════════════════════════════════════════════

function pasoHoras(ctx) {
  const { y, fmtMinutes } = ctx;
  if (!y.min) return null;
  const dias = y.min / 1440;
  const porDia = y.min / Math.max(1, y.days_active);
  return {
    id: 'horas',
    etiqueta: String(y.year),
    num: [y.min, 'min'],
    bajada: `de música en ${y.year}`,
    cuerpo: `Son ${coma(dias)} días enteros, del tirón y sin dormir, repartidos en ` +
            `${num(y.plays)} reproducciones. Los días que pusiste algo te salen a ` +
            `${fmtMinutes(porDia)} de media.`,
  };
}

function pasoMeses(ctx) {
  const { y, stats, fmtMinutes } = ctx;
  const meses = (stats.monthly || [])
    .filter(m => m.m.slice(0, 4) === String(y.year))
    .map(m => ({ i: +m.m.slice(5, 7), min: m.min }));
  if (meses.length < 3) return null;   // con dos barras no hay curva que leer

  const max = Math.max(...meses.map(m => m.min));
  const pico = meses.find(m => m.min === max);
  const min = Math.min(...meses.map(m => m.min));
  const flojo = meses.find(m => m.min === min);
  const ultimo = meses[meses.length - 1];
  const esUltimoAnio = y.year === Math.max(...stats.years.map(yy => yy.year));

  // ¿baja sin parar desde el pico? Es lo que hace que la curva cuente algo, y
  // no se puede escribir a mano: depende del año que estés mirando.
  const despues = meses.slice(meses.indexOf(pico));
  const enCaida = despues.length >= 3 && despues.every((m, i) => i === 0 || m.min <= despues[i - 1].min);

  let cuerpo = `${ctx.MESES[pico.i - 1]} fue tu mes más alto, con ${fmtMinutes(pico.min)}. `;
  if (enCaida) {
    cuerpo += `Desde ahí bajas todos los meses hasta ${ctx.MESES[ultimo.i - 1]}, que se queda en ` +
              `${fmtMinutes(ultimo.min)} — menos de la mitad.`;
  } else {
    cuerpo += `El más flojo fue ${ctx.MESES[flojo.i - 1]}, con ${fmtMinutes(flojo.min)}: ` +
              `entre uno y otro hay ${fmtMinutes(pico.min - flojo.min)} de diferencia.`;
  }
  if (esUltimoAnio && ctx.ultimoDia) {
    cuerpo += ` Ojo con la última barra: está cortada el ${ctx.fmtDia(ctx.ultimoDia)}, ` +
              `que es donde termina el export.`;
  }

  return {
    id: 'meses',
    etiqueta: `${y.year}, mes a mes`,
    titular: `${ctx.MESES[pico.i - 1]} fue el pico`,
    chico: true,
    bajada: fmtMinutes(pico.min),
    visual: visualMeses(meses, max, ctx),
    cuerpo,
  };
}

function pasoArtista(ctx) {
  const { y, fmtMinutes } = ctx;
  const top = (y.top_artists || []).slice(0, 8);
  if (!top.length) return null;
  const uno = top[0];

  let cuerpo = `${fmtMinutes(uno.min)} en ${num(uno.plays)} reproducciones.`;
  if (top[1]) {
    const dif = Math.round(uno.min - top[1].min);
    cuerpo += ` Le saca ${num(dif)} minutos a ${esc(top[1].name)}.`;
    if (top[3]) {
      const cola = top[2].min - top[top.length - 1].min;
      cuerpo += cola < uno.min - top[1].min
        ? ` Del tercero para abajo se apelotonan: entre el tercero y el octavo hay menos diferencia que entre el primero y el segundo.`
        : ` Y por debajo la cola cae despacio, sin escalones.`;
    }
  }

  return {
    id: 'artista',
    etiqueta: 'Artista del año',
    titular: uno.name,
    chico: true,
    bajada: `${fmtMinutes(uno.min)} · ${num(uno.plays)} reproducciones`,
    visual: visualRanking(top, fmtMinutes),
    cuerpo,
  };
}

function pasoAlbum(ctx) {
  const { y, fmtMinutes } = ctx;
  const top = (y.top_albums || [])[0];
  if (!top) return null;
  const dos = (y.top_albums || [])[1];

  let cuerpo = `${fmtMinutes(top.min)} en ${num(top.plays)} reproducciones.`;
  if (dos) {
    const veces = top.min / Math.max(1, dos.min);
    cuerpo += veces >= 1.8
      ? ` Más del doble que el segundo, ${esc(dos.name)}: ningún otro disco del año se le acerca.`
      : ` El segundo, ${esc(dos.name)}, se queda en ${fmtMinutes(dos.min)}.`;
  }

  return {
    id: 'album',
    etiqueta: 'Álbum del año',
    titular: top.name,
    chico: true,
    tapa: top.img || null,
    bajada: top.artist,
    cuerpo,
  };
}

function pasoDias(ctx) {
  const { y, fmtMinutes, fmtDia } = ctx;
  const D = y.days;
  // Sin `days` no hay calendario y punto: antes que dibujar 232 cuadraditos
  // seguidos con el orden inventado y aclararlo en el pie, no se dibuja.
  if (!D || !Array.isArray(D.min) || !D.min.length) return null;

  const cubiertos = D.min.length;
  const activos = D.min.filter(v => v > 0).length;
  const huecos = cubiertos - activos;
  const iPico = D.min.reduce((mejor, v, i) => (v > D.min[mejor] ? i : mejor), 0);
  const fechaPico = isoDesde(aMs(D.from) + iPico * 86400000);
  const media = y.min / Math.max(1, activos);

  let cuerpo = `Las columnas son semanas y las filas, días de la semana: cada cuadradito ` +
               `es el día que dice ser y su color, lo que escuchaste ese día. `;
  cuerpo += huecos === 0
    ? `No hay un solo día en blanco en todo el tramo.`
    : `Los ${num(huecos)} apagados son los días en los que no sonó nada.`;
  cuerpo += ` El del borde marcado es el ${fmtDia(fechaPico)}, con ${fmtMinutes(D.min[iPico])}: ` +
            `casi ${coma(D.min[iPico] / Math.max(1, media))} veces un día normal tuyo. ` +
            `La racha más larga fue de ${num(y.longest_streak)} días seguidos.`;

  return {
    id: 'dias',
    etiqueta: 'Días con música',
    num: [activos, 'ent'],
    bajada: `de los ${num(cubiertos)} que cubre el historial`,
    visual: visualCalendario(D, iPico, ctx),
    cuerpo,
  };
}

function pasoDentroDeTodo(ctx) {
  const { y, stats, fmtMinutes } = ctx;
  const t = stats.totals || {};
  const totalPlays = t.plays_valid || 0;
  // Sin más historial que el año que miras, no hay comparación que hacer.
  if (!totalPlays || totalPlays <= y.plays * 1.02) return null;
  if ((stats.years || []).length < 2) return null;

  const parte = y.plays / totalPlays * 100;
  const anios = stats.years.length;

  let cuerpo = `De las ${num(totalPlays)} reproducciones válidas que Spotify tiene tuyas ` +
               `en ${anios} años, ${pct(parte)} son de ${y.year}.`;
  if (typeof y.skip_pct === 'number' && typeof t.skip_pct === 'number') {
    const mejor = t.skip_pct - y.skip_pct;
    cuerpo += Math.abs(mejor) < 3
      ? ` Y escuchas igual que siempre: cortas el ${pct(y.skip_pct)} de lo que pones, contra el ${pct(t.skip_pct)} histórico.`
      : mejor > 0
        ? ` Y este año aguantas mucho más: dejas a medias el ${pct(y.skip_pct)} de lo que pones, ` +
          `cuando en el total de tu historial la cifra es ${pct(t.skip_pct)}. Antes cortabas ` +
          `${Math.round(t.skip_pct / 10)} de cada 10 canciones; ahora, ${Math.round(y.skip_pct / 10)}.`
        : ` Aunque este año cortas más que de costumbre: ${pct(y.skip_pct)} contra el ${pct(t.skip_pct)} histórico.`;
  }
  cuerpo += ` Ninguna tarjeta de las de abajo da este número: todas miran un año por vez.`;

  return {
    id: 'dentro',
    etiqueta: `${y.year} dentro de todo`,
    num: [parte, 'pct'],
    bajada: 'de todo lo que has escuchado es de este año',
    visual: visualPuntos(y, totalPlays),
    cuerpo,
    extra: { plays: y.plays, totalPlays },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LOS DIBUJOS — todos van DENTRO del panel, no en una columna al lado
// ═══════════════════════════════════════════════════════════════════════════

function visualMeses(meses, max, ctx) {
  return `<div class="wr-ap-visual"><div class="wr-ap-meses">` +
    meses.map(m => `
      <div class="wr-ap-mes${m.min === max ? ' pico' : ''}">
        <div class="wr-ap-mes-val"><span class="wr-ap-num" data-num="${m.min / 60}" data-fmt="pl">${Math.round(m.min / 60)}</span>h</div>
        <div class="wr-ap-barra" data-alto="${(m.min / max * 100).toFixed(2)}"></div>
        <div class="wr-ap-mes-lbl">${ctx.MESES[m.i - 1]}</div>
      </div>`).join('') +
    `</div></div>`;
}

function visualRanking(items, fmtMinutes) {
  const max = items[0].min;
  return `<div class="wr-ap-visual"><div class="wr-ap-ranking">` +
    items.map((it, i) => `
      <div class="wr-ap-fila${i === 0 ? ' uno' : ''}">
        <span class="pos">${i + 1}</span>
        <span class="pista">
          <span class="b" data-ancho="${(it.min / max * 100).toFixed(2)}"></span>
          <span class="nom">${esc(it.name)}</span>
        </span>
        <span class="val">${fmtMinutes(it.min)}</span>
      </div>`).join('') +
    `</div></div>`;
}

/**
 * El calendario: columnas = semanas, filas = día de la semana.
 *
 * Los huecos del arranque no son decorativos. Si el año empieza un jueves y la
 * primera columna arrancara en la primera fila, las filas dejarían de ser días
 * de la semana y el dibujo mentiría — más fino que una rejilla con el orden
 * inventado, pero mentiría igual.
 *
 * Los tres tonos salen de los TERCILES de los días activos de ESE año, no de
 * umbrales fijos: con umbrales fijos, 2018 (68 días, mucho menos volumen) se
 * vería entero del tono más flojo y 2025 entero del más fuerte, y el gradiente
 * dejaría de decir nada dentro de cada año.
 */
function visualCalendario(D, iPico, ctx) {
  const activos = D.min.filter(v => v > 0).sort((a, b) => a - b);
  const t1 = activos[Math.floor(activos.length / 3)] || 0;
  const t2 = activos[Math.floor(activos.length * 2 / 3)] || 0;
  const nivel = v => (v === 0 ? 0 : v < t1 ? 1 : v < t2 ? 2 : 3);

  const offset = diaSemanaLunes(D.from);
  const semanas = Math.ceil((offset + D.min.length) / 7);

  let celdas = '';
  for (let h = 0; h < offset; h++) celdas += '<i class="hueco" aria-hidden="true"></i>';
  for (let i = 0; i < D.min.length; i++) {
    const n = nivel(D.min[i]);
    const iso = isoDesde(aMs(D.from) + i * 86400000);
    celdas += `<i class="${n ? 'n' + n : ''}${i === iPico ? ' pico' : ''}" ` +
              `title="${ctx.fmtDia(iso)} · ${D.min[i] > 0 ? ctx.fmtMinutes(D.min[i]) : 'nada'}"></i>`;
  }

  // Una etiqueta por mes, en la columna donde cae su día 1. Van sobre las
  // MISMAS columnas que la rejilla: si la fila de meses se auto-dimensiona por
  // el ancho del texto, «ene» empuja a «feb» y ninguna cae sobre su semana.
  const etiquetas = new Array(semanas).fill('');
  for (let i = 0; i < D.min.length; i++) {
    const ms = aMs(D.from) + i * 86400000;
    const f = new Date(ms);
    if (f.getUTCDate() === 1) etiquetas[Math.floor((offset + i) / 7)] = ctx.MESES[f.getUTCMonth()];
  }

  const muestra = (n) => `<i class="wr-ap-leg-c ${n}"></i>`;
  return `<div class="wr-ap-visual" style="--semanas:${semanas}">
    <div class="wr-ap-cal-meses">${etiquetas.map(e => `<span>${e}</span>`).join('')}</div>
    <div class="wr-ap-cal">${celdas}</div>
    <div class="wr-ap-leyenda">
      <span class="wr-ap-leg">${muestra('n0')}Nada</span>
      <span class="wr-ap-leg">${muestra('n1')}Hasta ${ctx.fmtMinutes(t1)}</span>
      <span class="wr-ap-leg">${muestra('n2')}Hasta ${ctx.fmtMinutes(t2)}</span>
      <span class="wr-ap-leg">${muestra('n3')}Más de ${ctx.fmtMinutes(t2)}</span>
    </div>
  </div>`;
}

function visualPuntos(y, totalPlays) {
  return `<div class="wr-ap-visual">
    <canvas class="wr-ap-lienzo" role="img"
      aria-label="${num(y.plays)} de ${num(totalPlays)} reproducciones son de ${y.year}"></canvas>
    <div class="wr-ap-leyenda" data-leyenda></div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// EL MONTAJE
// ═══════════════════════════════════════════════════════════════════════════

const FMT = {
  min: (v, ctx) => ctx.fmtMinutes(v),
  ent: v => num(Math.round(v)),
  pct: v => pct(v),
  pl: v => String(Math.round(v)),
};

/**
 * @param {HTMLElement} host  el hueco vacío que dejó `render()`
 * @param {object} ctx        { stats, y, MESES, fmtMinutes, fmtDia, ultimoDia }
 * @returns {{destruir:()=>void}|null}  null si no hay recorrido que hacer
 */
export function montarApertura(host, ctx) {
  destruirVivo();
  if (!host || !ctx || !ctx.y || !ctx.stats) return null;

  const pasos = [pasoHoras, pasoMeses, pasoArtista, pasoAlbum, pasoDias, pasoDentroDeTodo]
    .map(f => { try { return f(ctx); } catch (e) { console.warn('[apertura] paso descartado:', e); return null; } })
    .filter(Boolean);

  // Menos de tres pantallas no es un recorrido, es un tropiezo antes de la
  // grilla. Mejor no montar nada y que el Wrapped empiece donde siempre.
  if (pasos.length < 3) return null;

  host.innerHTML = `
    <section class="wr-ap" aria-label="Recorrido del año ${ctx.y.year}">
      <div class="wr-ap-pista">
        <div class="wr-ap-clavado">
          ${pasos.map((p, i) => `
            <article class="wr-ap-paso" data-i="${i}" data-id="${p.id}">
              ${p.tapa ? `<img class="wr-ap-tapa" src="${esc(p.tapa)}" alt="" loading="lazy"
                   onerror="this.style.visibility='hidden'">` : ''}
              <div class="wr-ap-label">${esc(p.etiqueta)}</div>
              <div class="wr-ap-dato${p.chico ? ' chico' : ''}">${
                p.num
                  ? `<span class="wr-ap-num" data-num="${p.num[0]}" data-fmt="${p.num[1]}">${FMT[p.num[1]](p.num[0], ctx)}</span>`
                  : esc(p.titular)
              }</div>
              ${p.bajada ? `<div class="wr-ap-bajada">${esc(p.bajada)}</div>` : ''}
              ${p.visual || ''}
              <p class="wr-ap-cuerpo">${p.cuerpo}</p>
            </article>`).join('')}
        </div>
      </div>
      <div class="wr-ap-cierre">
        <p>Y ahora, todo junto.</p>
      </div>
      <div class="wr-ap-prog" hidden aria-hidden="true"></div>
      <button type="button" class="wr-ap-saltar" hidden>Saltar al resumen ↓</button>
    </section>
  `;

  const raiz = host.querySelector('.wr-ap');
  const pista = host.querySelector('.wr-ap-pista');
  const paneles = [...host.querySelectorAll('.wr-ap-paso')];
  const prog = host.querySelector('.wr-ap-prog');
  const saltar = host.querySelector('.wr-ap-saltar');
  const nums = [...host.querySelectorAll('.wr-ap-num')];
  const barras = [...host.querySelectorAll('.wr-ap-barra')];
  const anchos = [...host.querySelectorAll('.wr-ap-fila .b')];
  const cals = [...host.querySelectorAll('.wr-ap-cal')];
  const lienzos = [...host.querySelectorAll('.wr-ap-lienzo')];

  const pasoDentro = pasos.find(p => p.id === 'dentro');

  // La barra de años se queda pegada arriba MIENTRAS dura el recorrido, y solo
  // entonces: la clase la pone y la quita este módulo, así que un Wrapped sin
  // apertura —animaciones apagadas, fallo del módulo, usuario sin historial—
  // se comporta exactamente igual que antes de v=216.
  //
  // El motivo no es estético. Sin esto, cambiar de año a mitad del recorrido
  // obliga a subir seis pantallas hasta los chips: medido en la app, estando en
  // el paso 5 los chips quedaban a 5.185 px por encima del viewport. El control
  // de la vista no puede estar enterrado debajo de su propia portada.
  const contenedor = host.parentElement;
  const barra = contenedor?.querySelector('.wrapped-year-bar');

  function medirBarra() {
    if (!barra || !raiz) return;
    raiz.style.setProperty('--wr-ap-top', Math.round(barra.getBoundingClientRect().height) + 'px');
  }

  let io = null;
  let ioPista = null;
  let disparos = [];
  let rafs = [];
  let activo = -1;
  let obsTema = null;
  let remedir = null;

  // ── el lienzo de puntos ───────────────────────────────────────────────────
  //
  // Un punto son 10 reproducciones. Los colores se leen de las variables CSS en
  // cada pintada, no se guardan: la paleta se cambia en runtime desde v=157 y
  // un color capturado al montar se quedaría viejo en cuanto alguien toque
  // «Papel». Por eso además hay un MutationObserver sobre el `style` de <html>,
  // que es donde `ui/theme-panel.js` escribe las variables.
  const POR_PUNTO = 10;

  function pintarLienzo(cv) {
    if (!pasoDentro) return;
    const ctx2d = cv.getContext && cv.getContext('2d');
    if (!ctx2d) return;                       // sin canvas queda el texto del panel
    const r = cv.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;

    const cs = getComputedStyle(document.documentElement);
    // Neutros y no el acento con alpha: a 3 px de lado el acento al 25 % se
    // confunde con el lleno.
    const col = {
      lleno: cs.getPropertyValue('--color-accent').trim() || '#7C3AED',
      fuera: cs.getPropertyValue('--color-border').trim() || '#2A2A3A',
    };
    const nAnio = Math.round(pasoDentro.extra.plays / POR_PUNTO);
    const nTodo = Math.round(pasoDentro.extra.totalPlays / POR_PUNTO);
    const grupos = [
      { n: nAnio, color: 'lleno', etiqueta: String(ctx.y.year), val: pasoDentro.extra.plays / pasoDentro.extra.totalPlays * 100 },
      { n: Math.max(0, nTodo - nAnio), color: 'fuera', etiqueta: 'Todo lo demás', val: (pasoDentro.extra.totalPlays - pasoDentro.extra.plays) / pasoDentro.extra.totalPlays * 100 },
    ];

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(r.width), h = Math.round(r.height);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx2d.setTransform(1, 0, 0, 1, 0, 0); ctx2d.scale(dpr, dpr);
    ctx2d.clearRect(0, 0, w, h);

    const total = grupos.reduce((a, g) => a + g.n, 0) || 1;
    const hueco = 14, wUtil = w - hueco * (grupos.length - 1);
    let paso = Math.sqrt((wUtil * h) / total);
    for (let k = 0; k < 24; k++) {
      if (Math.ceil(total / Math.max(1, Math.floor(wUtil / paso))) * paso <= h) break;
      paso *= 0.94;
    }
    const lado = Math.max(1.2, paso - 1);
    let x0 = 0;
    for (const g of grupos) {
      const cols = Math.max(1, Math.floor((g.n / total * wUtil) / paso));
      ctx2d.fillStyle = col[g.color];
      for (let i = 0; i < g.n; i++) {
        ctx2d.fillRect(x0 + (i % cols) * paso, h - Math.floor(i / cols) * paso - paso, lado, lado);
      }
      x0 += cols * paso + hueco;
    }

    const ley = cv.parentElement?.querySelector('[data-leyenda]');
    if (ley) {
      ley.innerHTML = grupos.map(g =>
        `<span class="wr-ap-leg"><i class="wr-ap-leg-c" style="background:${g.color === 'lleno' ? col.lleno : col.fuera}"></i>` +
        `${esc(g.etiqueta)} <b>${pct(g.val)}</b></span>`).join('');
    }
  }

  // ── estado final: todo puesto, nada escondido ─────────────────────────────
  function finales() {
    nums.forEach(n => { n.textContent = FMT[n.dataset.fmt](+n.dataset.num, ctx); });
    barras.forEach(b => { b.style.height = b.dataset.alto + '%'; });
    anchos.forEach(b => { b.style.width = b.dataset.ancho + '%'; });
    cals.forEach(c => {
      c.classList.remove('apagado');
      c.querySelectorAll('i').forEach(e => { e.style.transitionDelay = ''; });
    });
    lienzos.forEach(pintarLienzo);
  }

  function destruir() {
    try { io?.disconnect(); } catch { /* nunca se creó */ }
    io = null;
    try { ioPista?.disconnect(); } catch { /* idem */ }
    ioPista = null;
    raiz?.classList.remove('fuera');
    try { obsTema?.disconnect(); } catch { /* idem */ }
    obsTema = null;
    clearTimeout(remedir);
    rafs.forEach(id => cancelAnimationFrame(id));
    rafs = [];
    disparos.forEach(d => d.remove());
    disparos = [];
    window.removeEventListener('resize', alRedimensionar);
    contenedor?.classList.remove('wr-con-apertura');
    raiz?.classList.remove('js');
    paneles.forEach(p => p.classList.remove('on', 'ido'));
    if (prog) { prog.hidden = true; prog.innerHTML = ''; }
    if (saltar) saltar.hidden = true;
    activo = -1;
    try { finales(); } catch { /* los nodos ya no están: nada que dejar puesto */ }
  }

  function alRedimensionar() {
    clearTimeout(remedir);
    remedir = setTimeout(() => {
      // La barra de años se parte en dos líneas abajo de cierto ancho: su alto
      // no es una constante que se pueda escribir en el CSS.
      medirBarra();
      if (activo >= 0) paneles[activo].querySelectorAll('.wr-ap-lienzo').forEach(pintarLienzo);
      else lienzos.forEach(pintarLienzo);
    }, 160);
  }

  // Arranca rápido y frena al final: el número se lee casi entero durante la
  // mayor parte de la animación, en vez de pasar volando hasta el último cuadro.
  const ease = t => (t === 1 ? 1 : 1 - Math.pow(2, -9 * t));
  const DUR_CONTADOR = 1050;

  function contar(el) {
    const destino = +el.dataset.num;
    const fmt = FMT[el.dataset.fmt];
    let t0 = null;
    const paso = ts => {
      if (t0 === null) t0 = ts;
      const t = Math.min(1, (ts - t0) / DUR_CONTADOR);
      el.textContent = fmt(destino * ease(t), ctx);
      if (t < 1) rafs.push(requestAnimationFrame(paso));
      else el.textContent = fmt(destino, ctx);
    };
    el.textContent = fmt(0, ctx);
    rafs.push(requestAnimationFrame(paso));
  }

  // El calendario entra día por día, en orden cronológico: son retardos de CSS,
  // ni un timer. El tope de 900 ms es para que un año entero (366 cuadraditos)
  // no tarde más que la propia lectura del panel.
  function encender(cal) {
    const cel = cal.querySelectorAll('i');
    const paso = Math.min(3.5, 900 / Math.max(1, cel.length));
    cel.forEach((c, i) => { c.style.transitionDelay = `${(i * paso).toFixed(1)}ms`; });
    cal.classList.remove('apagado');
  }

  function estrenar(p) {
    p.querySelectorAll('.wr-ap-num').forEach(contar);
    p.querySelectorAll('.wr-ap-barra').forEach(b => { b.style.height = b.dataset.alto + '%'; });
    p.querySelectorAll('.wr-ap-fila .b').forEach(b => { b.style.width = b.dataset.ancho + '%'; });
    p.querySelectorAll('.wr-ap-cal').forEach(encender);
    // El lienzo se mide RECIÉN acá: antes el panel está en opacity 0 pero con
    // caja, y medirlo escondido daba tamaños de punto equivocados al cambiar de
    // paleta con el panel fuera de pantalla.
    p.querySelectorAll('.wr-ap-lienzo').forEach(pintarLienzo);
  }

  function activar(i) {
    if (i === activo) return;
    // Entre que el usuario cambia de año y que el recorrido nuevo llama a
    // `destruirVivo()` hay una ventana en la que el observer VIEJO sigue vivo
    // sobre nodos que `render()` ya tiró. Escribir ahí no tira —el DOM
    // desconectado acepta todo— pero deja contadores corriendo contra paneles
    // que nadie mira. Esta línea es el corte.
    if (!raiz.isConnected) { destruir(); return; }
    activo = i;
    paneles.forEach((p, j) => {
      p.classList.toggle('on', j === i);
      p.classList.toggle('ido', j < i);
    });
    prog.querySelectorAll('i').forEach((b, j) => b.classList.toggle('on', j === i));
    estrenar(paneles[i]);
  }

  function armar() {
    if (typeof IntersectionObserver !== 'function') return false;

    pasos.forEach((_, i) => {
      const d = document.createElement('div');
      d.className = 'wr-ap-disparo';
      d.dataset.i = String(i);
      pista.appendChild(d);
      disparos.push(d);
    });

    io = new IntersectionObserver(entradas => {
      for (const e of entradas) if (e.isIntersecting) activar(+e.target.dataset.i);
    }, { rootMargin: '-50% 0px -50% 0px', threshold: 0 });

    // Los puntos de avance y el botón de saltar son `position: fixed`, así que
    // sin esto se quedarían flotando sobre el Wrapped para siempre una vez
    // pasado el recorrido.
    //
    // ⚠️ El `rootMargin` NO es cosmético y el primer intento estaba mal. Observar
    // la pista contra el viewport entero pregunta «¿se ve algo de la pista?», y
    // eso sigue siendo `true` cuando ya pasaste el recorrido y la pista asoma
    // por arriba — o directamente para siempre si debajo no hay bastante
    // contenido como para sacarla de pantalla. El banco lo cazó: con el Wrapped
    // corto los dos controles se quedaban puestos.
    //
    // `0px 0px -99% 0px` deja la raíz reducida a una banda del 1 % pegada al
    // BORDE SUPERIOR. La pista cruza esa banda exactamente mientras el bloque
    // clavado está pegado arriba, que es la definición de «el recorrido está en
    // marcha». Antes de llegar tampoco la cruza, así que de paso los controles
    // no aparecen hasta que el recorrido empieza.
    ioPista = new IntersectionObserver(([e]) => {
      raiz.classList.toggle('fuera', !e.isIntersecting);
    }, { rootMargin: '0px 0px -99% 0px', threshold: 0 });

    try {
      disparos.forEach(d => io.observe(d));
      ioPista.observe(pista);
    } catch (e) {
      console.warn('[apertura] observe() falló, queda todo visible:', e);
      return false;
    }

    // ⚠️ RECIÉN ACÁ se esconde algo, y solo lo que la maquinaria de arriba sabe
    // devolver a su sitio. Si cualquier línea anterior hubiera tirado, no se
    // habría escondido nada.
    barras.forEach(b => { b.style.height = '0'; });
    anchos.forEach(b => { b.style.width = '0'; });
    cals.forEach(c => c.classList.add('apagado'));

    prog.innerHTML = pasos.map(() => '<i></i>').join('');
    prog.hidden = false;
    saltar.hidden = false;
    raiz.classList.add('js');
    contenedor?.classList.add('wr-con-apertura');
    medirBarra();
    activar(0);

    obsTema = new MutationObserver(() => {
      if (activo >= 0) paneles[activo].querySelectorAll('.wr-ap-lienzo').forEach(pintarLienzo);
    });
    obsTema.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', alRedimensionar);
    return true;
  }

  saltar.onclick = () => {
    const fin = host.querySelector('.wr-ap-cierre');
    if (fin) fin.scrollIntoView({ behavior: animationsEnabled() ? 'smooth' : 'auto', block: 'start' });
  };

  // Con el toggle en «apagadas» la apertura NO se clava: queda la misma lista
  // compacta y quieta del estado base. Es el mismo camino que el del fallo, así
  // que se prueba solo cada vez que alguien apaga el toggle.
  if (animationsEnabled()) {
    if (!armar()) destruir();
  } else {
    finales();
  }

  vivo = { destruir };
  return vivo;
}

/** Para que `wrapped.js` pueda soltar el recorrido antes de repintar. */
export function soltarApertura() {
  destruirVivo();
}
