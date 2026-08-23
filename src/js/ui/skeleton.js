// Esqueletos de carga (v=154). UN componente para toda la app, no uno por vista.
//
// La idea: el hueco que va a ocupar el contenido se pinta ya, con rectángulos
// del tamaño aproximado de lo que viene. Así el modal (o la vista) aparece
// entero al instante y lo único que cambia después es el relleno: nada salta de
// sitio, nada aparece de la nada, y el usuario ve la FORMA de lo que está
// esperando en vez de un spinner que no dice nada.
//
// Todas las funciones devuelven HTML (string), igual que el resto de los
// helpers de ui/ — se insertan con innerHTML donde antes iba el spinner.
//
// ⚠️ El shimmer se ATENÚA bajo `prefers-reduced-motion`, NO se apaga. Es la
// lección de las barritas del player (v=141): apagar la animación deja un
// bloque gris quieto, que se lee como «esto está roto», no como «esto está
// cargando». Ian tiene reduced-motion activo en GNOME, así que el camino
// atenuado es el que ve él todos los días — no es el caso raro. El CSS (y la
// variante suave del keyframe) vive en css/components.css.

// Un rectángulo. `w` acepta cualquier unidad CSS ('60%', '120px'); `h` va en px
// si le pasás un número.
export function skelBox({ w = '100%', h = 14, radius = 6, mb = 0, className = '' } = {}) {
  const alto = typeof h === 'number' ? `${h}px` : h;
  const ancho = typeof w === 'number' ? `${w}px` : w;
  const margen = mb ? `margin-bottom:${typeof mb === 'number' ? `${mb}px` : mb};` : '';
  return `<div class="skel ${className}" style="width:${ancho};height:${alto};border-radius:${radius}px;${margen}"></div>`;
}

// N líneas de texto de anchos distintos. Los anchos se alternan a propósito: un
// bloque de líneas todas iguales se lee como una tabla, no como texto.
export function skelText(lines = 3, { h = 12, gap = 8, widths = null } = {}) {
  const anchos = widths || ['92%', '78%', '85%', '64%', '88%', '72%'];
  const out = [];
  for (let i = 0; i < lines; i++) {
    out.push(skelBox({ w: anchos[i % anchos.length], h, mb: i === lines - 1 ? 0 : gap }));
  }
  return out.join('');
}

// Filas de una lista de pistas: la misma silueta que `.album-modal-like-row`
// (♥ · nº · nombre · ▶). Se usa en la ficha de álbum y en «Mis likes» del
// artista, que es la misma forma.
export function skelTrackRows(n = 10) {
  // Anchos de nombre variados para que no parezca una grilla.
  const anchos = ['72%', '54%', '81%', '63%', '76%', '48%', '68%', '85%', '58%', '70%'];
  const filas = [];
  for (let i = 0; i < n; i++) {
    filas.push(`
      <div class="skel-row">
        ${skelBox({ w: 11, h: 11, radius: 3 })}
        ${skelBox({ w: 14, h: 11, radius: 3 })}
        <div class="skel-row-main">${skelBox({ w: anchos[i % anchos.length], h: 12 })}</div>
        ${skelBox({ w: 20, h: 20, radius: 999 })}
      </div>
    `);
  }
  return `<div class="skel-rows">${filas.join('')}</div>`;
}

// Cabecera + filas: lo que ocupa el panel de pistas de la ficha de álbum
// mientras se resuelven los likes y el tracklist.
export function skelTracklist(n = 10) {
  return `
    <div class="skel-tracklist">
      <div class="skel-tracklist-head">${skelBox({ w: '58%', h: 13 })}</div>
      ${skelTrackRows(n)}
    </div>
  `;
}

// Bloque genérico para el cuerpo de una ficha (artista / canción): un par de
// tiles de stats arriba y texto abajo.
export function skelCardBody({ tiles = 3, lines = 4 } = {}) {
  const t = [];
  for (let i = 0; i < tiles; i++) {
    t.push(`<div class="skel-tile">${skelBox({ w: '55%', h: 18, mb: 8 })}${skelBox({ w: '80%', h: 10 })}</div>`);
  }
  return `
    <div class="skel-card-body">
      <div class="skel-tiles">${t.join('')}</div>
      <div class="skel-lines">${skelText(lines)}</div>
    </div>
  `;
}

// Placeholder de RUTA: lo que ocupa el hueco de `main` entre que se vacía y que
// la feature pinta lo suyo. Reemplaza al spinner suelto que había en el router
// (v=140) — mismo paso sincrónico, misma garantía de «main nunca vacío», pero
// con la silueta de una página en vez de una ruedita.
export function skelPage() {
  return `
    <div class="skel-page" data-route-placeholder>
      <div class="skel-page-head">
        ${skelBox({ w: 36, h: 36, radius: 8 })}
        ${skelBox({ w: 220, h: 22, radius: 6 })}
      </div>
      <div class="skel-page-grid">
        ${[0, 1, 2].map(() => `<div class="skel-card">${skelBox({ w: '45%', h: 26, mb: 10 })}${skelBox({ w: '70%', h: 11 })}</div>`).join('')}
      </div>
      <div class="skel-card skel-card-tall">${skelBox({ w: '32%', h: 15, mb: 16 })}${skelText(5, { h: 11, gap: 12 })}</div>
    </div>
  `;
}
