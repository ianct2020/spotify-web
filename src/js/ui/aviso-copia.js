// El aviso fijo de «se cargó una copia en otra pestaña» (tanda 80, v=335). Ver `util/canal-copia.js`.
//
// Arriba, fijo, en todas las rutas, y SIN botón de cerrar: mientras esta pestaña no recargue, sus almacenes pueden
// guardar lo de antes encima de lo que trajo la copia. 🔴 No recarga sola: el botón «Recargar» lo hace al pulsarlo
// (esta pestaña puede estar a mitad de un borrado verificado o de una escritura en Spotify). Que el aviso además
// impida guardar a los almacenes no se hizo: desde v=339 la unión de abajo lo reemplaza.
//
// Clases propias (`.aviso-copia…`, en `components.css`; la regla de `.wt-play-btn`, v=219), colores del tema, sin
// animación. Mismo molde que `ui/degraded-banner.js`.
//
// (v=339, diseñada en la tanda 81) Desde que los almacenes ya cargados unen lo que trajo la copia (`util/hidden-sync.js`), perder lo
// importado solo pasa en una carrera de milisegundos (un guardado de esta pestaña entre la escritura de la otra y la
// llegada del mensaje). El aviso SE QUEDA, como red para eso y para las vistas que siguen pintando lo de antes, y dice
// lo que es cierto ahora.

import { escucharCopiaImportada } from '../util/canal-copia.js';

const AVISO_ID = 'aviso-copia';

export function mostrarAvisoDeCopia() {
  if (document.getElementById(AVISO_ID)) return;
  const aviso = document.createElement('div');
  aviso.id = AVISO_ID;
  aviso.className = 'aviso-copia';
  aviso.setAttribute('role', 'alert');
  aviso.innerHTML = `
    <span class="aviso-copia-texto">Se ha cargado una copia en otra pestaña. Lo que trajo ya cuenta en esta, pero recárgala para que todas las vistas lo enseñen.</span>
    <button class="btn btn-secondary btn-sm" id="aviso-copia-recargar" type="button">Recargar</button>
  `;
  document.body.appendChild(aviso);
  document.body.classList.add('con-aviso-copia');
  aviso.querySelector('#aviso-copia-recargar').onclick = () => location.reload();
}

/** Lo llama `app.js` al arrancar. Sin `BroadcastChannel`, no hace nada. */
export function escucharAvisoDeCopia() {
  return escucharCopiaImportada(() => mostrarAvisoDeCopia());
}
