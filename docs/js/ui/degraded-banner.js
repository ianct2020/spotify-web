// Banner de "modo degradado" para vistas que resuelven el owner por
// `fonoteca_last_user_id` en vez de `/me` (ver `isOwner()` en
// `features/history-data.js`). Mismas clases CSS que el banner de arranque de
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
      <strong>Modo degradado:</strong> no se pudo confirmar tu identidad con
      Spotify (Spotify está limitando las consultas). Esta vista se muestra
      con el usuario que tenías guardado en este navegador.
    </span>
    <button class="btn btn-secondary btn-sm" id="banner-degradado-recargar" type="button">Recargar</button>
  `;
  document.body.appendChild(banner);
  document.body.classList.add('con-banner-degradado');
  banner.querySelector('#banner-degradado-recargar').onclick = () => location.reload();
}
