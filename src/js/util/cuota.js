// La cuota a la vista (v=310, tanda 58): lo gastado de las DOS cuotas de Spotify
// que la app ya choca, contado en esta pestaña.
//
//   · `busqueda`: `/search`. 429 `QUOTA_EXCEEDED` tras unas 700 peticiones (medido
//     el 18/09/2026), compartida por toda la app.
//   · `discografia`: `/artists/{id}/albums`, el nativo. 429 tras 100 (medido el
//     16/09/2026), y sigue en 429 más de 23 minutos.
//
// Lo alimenta `spotifyFetch` (`api.js`): cada petición de esas dos que salió a la
// red y volvió con una respuesta (un 429 también salió, también cuenta), cada 429
// con su hora, la pausa que puso `api.js` y cada pedido que la pausa cortó ANTES
// de salir. 🔴 Un pedido cortado por la pausa NO es una petición: no gastó cuota.
// Va aparte, como «cortada».
//
// 🔴 Por pestaña y por carga, a propósito, igual que `artistAlbumsDiag`: nace en
// cero en cada carga y se guarda en `sessionStorage` (`fonoteca_cuota_v1`) para
// poder leerlo desde la pestaña. La cuota de Spotify es de la CUENTA, no de la
// pestaña: el `title` del renglón lo dice. Y no alimenta nada de vuelta: la pausa
// sigue viviendo en `api.js` y muere al recargar, como antes.
//
// 🔴 El tope MEDIDO va en el `title`, nunca en el renglón como «de 700»: no es un
// límite publicado, es lo que midió una tanda una vez. Ponerlo como denominador
// sería mentir con formato de dato (lo vigila `tests/cuota.test.mjs`).
//
// Hoja PURA donde se puede: sin imports, sin reloj propio, sin DOM. El contador
// (`crearContador`) recibe el guardado, el aviso y el reloj; el de la app
// (`contadorCuota`) enchufa `sessionStorage`, el evento `cuotachange` sobre
// `window` y `Date.now`. El pie del menú (`ui/cuota-pie.js`) escucha el evento.

export const CLAVE_CUOTA = 'fonoteca_cuota_v1';
export const EVENTO_CUOTA = 'cuotachange';
export const CUOTAS = ['busqueda', 'discografia'];

const ETIQUETA = { busqueda: 'Búsqueda', discografia: 'Discografías' };
// Lo medido, con su fecha. Solo lo lee `tituloRenglon`.
const TOPE_MEDIDO = {
  busqueda: 'Spotify cortó la búsqueda tras unas 700 peticiones el 18/09/2026',
  discografia: 'Spotify cortó las discografías tras 100 peticiones el 16/09/2026',
};

const cero = () => ({ peticiones: 0, cortadas: 0, n429: 0, ultimo429: null, pausaHasta: null });

export function estadoInicial() {
  return { busqueda: cero(), discografia: cero() };
}

/** De qué cuota es un endpoint de `spotifyFetch` (relativo o absoluto), o null. */
export function cuotaDeEndpoint(endpoint) {
  const ruta = String(endpoint || '').replace(/^https:\/\/api\.spotify\.com\/v1/, '');
  if (/^\/search(\?|$)/.test(ruta)) return 'busqueda';
  if (/^\/artists\/[^/?]+\/albums(\?|$)/.test(ruta)) return 'discografia';
  return null;
}

// Copia el estado y le aplica `cambio` a UNA cuota. Una cuota desconocida no toca nada.
function con(estado, cuota, cambio) {
  if (!CUOTAS.includes(cuota)) return estado;
  const nuevo = { busqueda: { ...estado.busqueda }, discografia: { ...estado.discografia } };
  cambio(nuevo[cuota]);
  return nuevo;
}

/** Una petición que salió a la red y volvió con `status`. */
export function anotarPeticion(estado, cuota, status, ahora) {
  return con(estado, cuota, (c) => {
    c.peticiones++;
    if (status === 429) { c.n429++; c.ultimo429 = ahora; }
  });
}

/** Un pedido que la pausa cortó ANTES de salir: no gastó cuota. */
export function anotarCortada(estado, cuota) {
  return con(estado, cuota, (c) => { c.cortadas++; });
}

/** La pausa que puso `api.js` tras un 429: hasta cuándo (ms). */
export function anotarPausa(estado, cuota, hasta) {
  return con(estado, cuota, (c) => { c.pausaHasta = hasta; });
}

const num = (n) => n.toLocaleString('es-ES');

function hace(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'hace menos de 1 min';
  if (min < 60) return `hace ${num(min)} min`;
  return `hace ${num(Math.floor(min / 60))} h`;
}

const hora = (t) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/** El renglón del pie para una cuota. `ahora` en ms. */
export function textoRenglon(cuota, estado, ahora) {
  const c = estado[cuota];
  const etiqueta = ETIQUETA[cuota];
  if (!c.peticiones && !c.cortadas) return `${etiqueta}: sin peticiones en esta pestaña`;
  let t = `${etiqueta}: ${num(c.peticiones)} ${c.peticiones === 1 ? 'petición' : 'peticiones'}`;
  if (!c.n429) t += ' · sin 429';
  else {
    t += ` · 429 ${hace(ahora - c.ultimo429)}`;
    if (c.pausaHasta && c.pausaHasta > ahora) t += `, en pausa hasta las ${hora(c.pausaHasta)}`;
  }
  if (c.cortadas) t += ` · ${num(c.cortadas)} ${c.cortadas === 1 ? 'cortada' : 'cortadas'} por la pausa`;
  return t;
}

/** El `title` del renglón: el tope medido, con su fecha, y de quién es la cuota. */
export function tituloRenglon(cuota) {
  return `${TOPE_MEDIDO[cuota]}; es un número medido una vez, no un límite publicado. `
    + 'La cuota es de tu cuenta de Spotify, pero esto cuenta solo esta pestaña desde que se cargó. '
    + '«Cortada por la pausa» es un pedido que la app no llegó a enviar.';
}

/**
 * El contador. `guardar(clave, json)` puede tirar (sessionStorage lleno o
 * bloqueado): se cuenta igual. `emitir(estado)` avisa de cada cambio.
 */
export function crearContador({ guardar, emitir, reloj }) {
  let estado = estadoInicial();
  const cambiar = (nuevo) => {
    estado = nuevo;
    try { guardar(CLAVE_CUOTA, JSON.stringify(estado)); } catch { /* ignora */ }
    try { emitir(estado); } catch { /* ignora */ }
  };
  return {
    estado: () => estado,
    peticion: (cuota, status) => cambiar(anotarPeticion(estado, cuota, status, reloj())),
    cortada: (cuota) => cambiar(anotarCortada(estado, cuota)),
    pausa: (cuota, hasta) => cambiar(anotarPausa(estado, cuota, hasta)),
  };
}

/** El de la app: `sessionStorage` y el evento `cuotachange` sobre `window`. */
export const contadorCuota = crearContador({
  guardar: (clave, valor) => globalThis.sessionStorage?.setItem(clave, valor),
  emitir: (estado) => {
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent(EVENTO_CUOTA, { detail: estado }));
    }
  },
  reloj: () => Date.now(),
});
