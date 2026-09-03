// Banner de "modo degradado" para vistas que no pudieron confirmar la identidad
// con `/me` (ver `isOwner()` en `features/history-data.js`).
//
// ⚠️ v=190: antes esto avisaba de que la vista se estaba mostrando CON el
// usuario guardado. Ya no: desde v=190 la identidad sin confirmar no concede
// acceso al historial, así que el cartel avisa de lo contrario — de que queda
// oculto. Si alguna vez se vuelve a tocar `isOwner()`, este texto va con él. Mismas clases CSS que el banner de arranque de
// `app.js` (v=173, `.banner-degradado`), pero sin su lógica de backoff: acá
// alcanza con avisar y ofrecer recargar. Si el de app.js ya está en pantalla
// (el arranque mismo detectó el 429), no se duplica — se deja ese, que además
// reintenta solo.
//
// Sin imports a propósito: lo usa `features/history-data.js`, y `app.js`
// importa de `features/history-data.js` — un import en el otro sentido sería
// un ciclo (mismo motivo que separa `ui/components.js` de
// `ui/preview-player.js`).
const BANNER_ID = 'banner-degradado';

export function mostrarBannerDegradadoVista() {
  if (document.getElementById(BANNER_ID)) return;
  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.className = 'banner-degradado';
  banner.innerHTML = `
    <span class="banner-degradado-punto" aria-hidden="true"></span>
    <span class="banner-degradado-texto">
      <strong>Modo degradado:</strong> Spotify está limitando las peticiones y no
      hemos podido confirmar tu identidad. La app funciona con lo que tenía
      guardado, pero <strong>el historial de escuchas queda oculto</strong>: sin
      saber de quién es, no se enseña.
    </span>
    <button class="btn btn-secondary btn-sm" id="banner-degradado-recargar" type="button">Recargar</button>
  `;
  document.body.appendChild(banner);
  document.body.classList.add('con-banner-degradado');
  banner.querySelector('#banner-degradado-recargar').onclick = () => location.reload();
}
