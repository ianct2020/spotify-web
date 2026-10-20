// UI de importación del Extended Streaming History (BYOH — Bring Your Own).
// Acepta ZIP del export de Spotify o los Streaming_History_Audio_*.json sueltos.
// Extrae + procesa + guarda todo en el IDB del user (nada sale de su compu).

import { processStreamingHistory, crearAcumuladorDeDias } from '../history-processor.js?v=320';
import {
  saveMyHistory, clearMyHistory, hasLocalHistory, guardarSoloDias,
  motivoSinImportCompleto, identityLockedMessage,
} from './history-data.js?v=320';
import { escapeHtml, showProgress, hideProgress, confirmModal, alertModal } from '../ui/components.js?v=320';
import { showToast } from '../ui/toast.js?v=320';
import { openModal, closeTop, closeById } from '../ui/modal-stack.js?v=320';

const OVERLAY_ID = 'import-history-overlay';
let overlay = null;

function close() {
  if (closeById(OVERLAY_ID)) {
    overlay = null;
  }
}

// La cabecera del modal, la misma con o sin selector: con la explicación del
// owner se queda igual, con su ✕.
const CABECERA = `
      <div class="ih-header">
        <div class="ih-header-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div style="flex:1;min-width:0">
          <h3 style="margin:0;font-size:17px">Mi historial de Spotify</h3>
          <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px">Todo se procesa en tu navegador — nada se sube a ningún lado</div>
        </div>
        <button class="btn btn-secondary btn-sm ih-close-btn" data-close-modal title="Cerrar" aria-label="Cerrar">✕</button>
      </div>`;

/**
 * Lo que se enseña en vez del selector cuando la guarda dice que no
 * (`motivoSinImportCompleto()`, history-data.js). SIN zona de arrastre, SIN
 * `<input type="file">` y SIN «Borrarlo»: `clearMyHistory()` se llevaría
 * también `local_<owner>_history_days`, que es lo que carga la importación
 * «solo el detalle».
 */
function cuerpoBloqueado(motivo) {
  // Identidad sin confirmar: el cartel que ya existe, sin copy nuevo.
  if (motivo === 'identidad') return identityLockedMessage('La importación');
  return `
      <div class="ih-bloqueo-owner" style="font-size:13px;line-height:1.5;color:var(--color-text-secondary)">
        <h4 style="margin:0 0 8px;font-size:15px;color:var(--color-text)">Tu historial ya está en la app</h4>
        <p style="margin:0 0 10px">Las vistas de historial de esta cuenta (Wrapped, Récords, Calendario, Mis tapas…) salen de datos preparados aparte, con correcciones hechas a mano. Importar aquí tu export los sustituiría por un cálculo hecho en el navegador, así que en esta cuenta la importación completa está desactivada.</p>
        <p style="margin:0">Si lo que quieres es ver qué sonó cada día, abre Calendario, elige un día y usa «Cargar el detalle por día desde tu export». Eso solo añade el detalle y no toca nada más.</p>
      </div>`;
}

async function openImportHistory() {
  close();
  // La guarda, capa 3. Las cuatro puertas que llegan acá (el botón «Mi
  // historial», `window.__openImportHistory`, el `[data-open-import]` del cartel
  // de bloqueo y el botón del panel de `#calendario`) pasan todas por este punto.
  const bloqueo = await motivoSinImportCompleto();
  if (bloqueo) {
    overlay = openModal({
      id: OVERLAY_ID,
      onClose: () => { overlay = null; },
      html: `
    <div class="modal ih-modal" data-import-bloqueado="${bloqueo}" style="max-width:560px;width:min(560px,94vw)">
      ${CABECERA}
      ${cuerpoBloqueado(bloqueo)}
    </div>
  `,
    });
    return;
  }

  const alreadyHas = await hasLocalHistory();

  overlay = openModal({
    id: OVERLAY_ID,
    onClose: () => { overlay = null; },
    html: `
    <div class="modal ih-modal" style="max-width:560px;width:min(560px,94vw)">
      ${CABECERA}

      <label id="ih-drop" class="ih-drop">
        <input type="file" id="ih-file" accept=".zip,application/zip,.json,application/json" multiple style="display:none">
        <div class="ih-drop-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="36" height="36">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="18" x2="12" y2="12"/>
            <line x1="9" y1="15" x2="12" y2="12"/>
            <line x1="15" y1="15" x2="12" y2="12"/>
          </svg>
        </div>
        <div class="ih-drop-title">Arrastra tu ZIP aquí</div>
        <div class="ih-drop-sub">o haz click para elegir · ZIP entero o JSONs sueltos</div>
      </label>

      <div id="ih-status" class="ih-status" aria-live="polite"></div>

      <details class="ih-howto">
        <summary>Cómo conseguir el ZIP <span class="ih-howto-hint">(si todavía no lo tienes)</span></summary>
        <ol>
          <li>Ve a <a href="https://www.spotify.com/account/privacy/" target="_blank" rel="noopener">spotify.com/account/privacy</a> con tu cuenta.</li>
          <li>Descarga hasta <strong>«Descargar tus datos»</strong>.</li>
          <li>Marca <strong>Historial de reproducción ampliado</strong> y confirma.</li>
          <li>Espera el mail (unos días). Cuando llegue, descargas el ZIP y lo subes aquí.</li>
        </ol>
        <button class="btn btn-secondary btn-sm" data-open-spotify-privacy>Abrir Privacidad de Spotify ↗</button>
      </details>

      ${alreadyHas ? `
        <div class="ih-clear-section">
          <div style="font-size:12px;color:var(--color-text-muted)">
            Ya tienes historial cargado en este navegador
          </div>
          <button class="btn btn-danger btn-sm" id="ih-clear">Borrarlo</button>
        </div>
      ` : ''}
    </div>
  `,
  });

  const drop = overlay.querySelector('#ih-drop');
  const input = overlay.querySelector('#ih-file');
  drop.onclick = () => input.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('dragging'); };
  drop.ondragleave = () => { drop.classList.remove('dragging'); };
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
    if (e.dataTransfer.files?.length) handleFiles([...e.dataTransfer.files]);
  };
  input.onchange = (e) => { if (e.target.files?.length) handleFiles([...e.target.files]); };

  const clearBtn = overlay.querySelector('#ih-clear');
  if (clearBtn) clearBtn.onclick = async () => {
    const ok = await confirmModal('Borrar tu historial local', 'Vas a borrar los agregados de tu Extended Streaming History guardados en este navegador. No afecta tu cuenta de Spotify ni el ZIP que descargaste — puedes volver a subirlo cuando quieras.', 'Borrar');
    if (!ok) return;
    // `clearMyHistory()` tira si la guarda dice que no o si no hay uid (v=309):
    // toast rojo y el modal se queda, sin anunciar un borrado que no se hizo.
    // Sin este `catch` el error llegaría al `unhandledrejection` y al banner.
    try {
      await clearMyHistory();
    } catch (e) {
      showToast(e?.message || 'No se ha podido borrar tu historial local.', 'error');
      return;
    }
    showToast('Historial local borrado', 'success');
    close();
    // Recargamos para que las features detecten el estado nuevo
    setTimeout(() => location.reload(), 400);
  };
}

async function handleFiles(files) {
  const status = document.getElementById('ih-status');
  const setStatus = (html, kind = 'info') => {
    if (!status) return;
    status.className = 'ih-status active' + (kind === 'error' ? ' error' : '');
    status.innerHTML = html;
  };

  // La guarda, capa 2: ANTES de leer, descomprimir o procesar nada. Si el owner
  // llegara hasta acá (un selector viejo abierto, otro camino que se agregue),
  // no se gastan los ~5 s de procesamiento para terminar rechazado en
  // `saveMyHistory()`: se le enseña la misma explicación.
  if (await motivoSinImportCompleto()) {
    await openImportHistory();
    return;
  }

  let jsonFiles = [];
  const zip = files.find(f => f.name.toLowerCase().endsWith('.zip'));
  const jsons = files.filter(f => f.name.toLowerCase().endsWith('.json'));

  if (zip) {
    setStatus(`<span class="spinner" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:6px"></span> Descomprimiendo ZIP…`);
    try {
      jsonFiles = await extractHistoryJsons(zip);
    } catch (e) {
      setStatus(`Error descomprimiendo: ${escapeHtml(e.message)}`, 'error');
      return;
    }
  } else if (jsons.length) {
    jsonFiles = jsons;
  } else {
    setStatus('Ningún archivo válido. Necesito el ZIP entero o los <code>Streaming_History_Audio_*.json</code>.', 'error');
    return;
  }

  const useful = jsonFiles.filter(f => /Streaming_History_Audio.*\.json$/i.test(f.name || ''));
  if (!useful.length) {
    setStatus('No encontré ningún <code>Streaming_History_Audio_*.json</code>. Necesitas el <em>Extended Streaming History</em> (el que tarda días), no el Account Data básico.', 'error');
    return;
  }

  setStatus(`Leyendo ${useful.length} archivo${useful.length === 1 ? '' : 's'}…`);

  const arrays = [];
  for (const f of useful) {
    const text = await readFileText(f);
    try {
      arrays.push(JSON.parse(text));
    } catch (e) {
      setStatus(`Error parseando ${escapeHtml(f.name)}: ${escapeHtml(e.message)}`, 'error');
      return;
    }
  }

  close();
  showProgress('Procesando tu historial…', 0, 0);
  await new Promise(r => setTimeout(r, 60)); // dejo que el DOM pinte el overlay antes de bloquear con el procesamiento

  let result;
  try {
    // El procesamiento es CPU intensivo. Lo que cede el hilo es el procesador
    // (v=297), con `cederElHilo` —el `MessageChannel` de abajo, que sirve
    // también en una pestaña oculta—; este `onProgress` solo pinta.
    result = await processStreamingHistory(arrays, {
      ceder: cederElHilo,
      onProgress: ({ phase, loaded, total }) => {
        const label = phase === 'dedup' ? 'Leyendo plays…' : 'Calculando agregados…';
        showProgress(label, loaded, total);
      },
    });
  } catch (e) {
    hideProgress();
    alertModal('Error procesando el historial', escapeHtml(e.message), { variant: 'error' });
    return;
  }

  showProgress('Guardando en tu navegador…', 0, 0);
  try {
    await saveMyHistory(result);
  } catch (e) {
    hideProgress();
    alertModal('Error guardando', escapeHtml(e.message), { variant: 'error' });
    return;
  }
  hideProgress();

  const totals = result.stats.totals;
  showToast(`Historial cargado: ${totals.plays_valid.toLocaleString('es-ES')} plays válidas · ${totals.days_active.toLocaleString('es-ES')} días activos`, 'success');
  setTimeout(() => location.reload(), 800);
}

function readFileText(file) {
  // Soporta tanto File real como el shim que devuelve extractHistoryJsons
  // (los ZIPs se descomprimen a texto directamente para evitar re-lectura).
  if (file && typeof file._jsonText === 'string') return Promise.resolve(file._jsonText);
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('No pude leer ' + file.name));
    r.readAsText(file);
  });
}

// ---- ZIP extractor casero ----
// Los ZIP de Spotify no están cifrados y usan deflate estándar. Podemos parsear
// el Central Directory y descomprimir con DecompressionStream (nativo, sin
// dependencias). Solo extraemos los .json que necesitamos — no metemos en
// memoria los PDFs u otros archivos del export.

async function extractHistoryJsons(zipFile) {
  const buf = await zipFile.arrayBuffer();
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // 1. Buscar End of Central Directory (EOCD): firma 0x06054b50, dentro de los
  //    últimos ~65KB. Ojo con ZIP64: si aparece la firma de ZIP64, no lo soportamos.
  const eocdSig = 0x06054b50;
  let eocdOffset = -1;
  const searchStart = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    if (view.getUint32(i, true) === eocdSig) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error('El archivo no parece un ZIP válido.');
  const numEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const out = [];
  let p = cdOffset;
  for (let i = 0; i < numEntries; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break; // CD file header sig
    const compressionMethod = view.getUint16(p + 10, true); // 0=stored, 8=deflate
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localHeaderOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    // Filtramos: solo Streaming_History_Audio_*.json (o parecidos)
    const base = name.split('/').pop();
    if (!/Streaming_History_Audio.*\.json$/i.test(base)) continue;
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error('ZIP64 no soportado (el export es demasiado grande para descomprimir en el navegador). Prueba desempaquetar y subir los .json sueltos.');
    }

    // 2. Local File Header: saltar name+extra locales para llegar a los datos
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

    let jsonText;
    if (compressionMethod === 0) {
      jsonText = new TextDecoder().decode(compressed);
    } else if (compressionMethod === 8) {
      // deflate raw (sin header zlib): DecompressionStream('deflate-raw')
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([compressed]).stream().pipeThrough(ds);
      const chunks = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(totalLen);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
      jsonText = new TextDecoder().decode(merged);
    } else {
      throw new Error(`Método de compresión ${compressionMethod} no soportado.`);
    }

    out.push({ name: base, text: jsonText, arrayBuffer: null });
  }

  // Devolvemos "pseudo-Files" con .name y un método readAsText-compat
  return out.map(o => ({
    name: o.name,
    text: () => Promise.resolve(o.text),
    // shim para readFileText — más simple: devolvemos texto directo bajo un método adhoc
    _jsonText: o.text,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// LA IMPORTACIÓN «SOLO EL DETALLE POR DÍA» — v=289
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠️ **POR QUÉ EL OWNER NO PUEDE PASAR POR `handleFiles()`** — y desde v=298
// de verdad no puede: hasta v=297 esto era una advertencia y no un candado.
//
// `saveMyHistory()` escribe las OCHO claves `local_{uid}_history_*`, y
// `loadOne()` (history-data.js) las consulta **antes** que los JSON horneados
// del repo. O sea que al owner un import completo le pisaría las siete vistas
// de historial con datos recalculados en el navegador: sin las correcciones a
// mano que llevan los JSON («Birds In The Trap Sing McKnight», v=151) y sin
// las tapas de `bake-covers.py`. Y pasaría sin fallar y sin avisar, que es el
// modo exacto que este repo viene marcando desde v=208.
//
// Lo impide `motivoSinImportCompleto()` (history-data.js), la regla escrita una
// sola vez, en tres capas: `openImportHistory()` le enseña una explicación en
// vez del selector, `handleFiles()` pregunta antes de leer nada, y
// `saveMyHistory()` tira (`err.importDelOwner`) antes de la primera escritura.
// Con la identidad sin confirmar también bloquea.
//
// Así que este modo:
//   · **NO corre `processStreamingHistory()`** — ni una vez;
//   · guarda **ÚNICAMENTE** `days`, por `guardarSoloDias()`;
//   · lee **archivo por archivo**: parsea uno, se lo pasa al acumulador y lo
//     suelta, así los 19 nunca están juntos en memoria.
//
// ⚠️ **Y CEDE EL HILO CON `MessageChannel`, NO CON `setTimeout`.** Chrome
// estrangula `setTimeout` a **uno por minuto** en una pestaña oculta, y en
// este proyecto está medido (ver la sección «Medir con la pestaña de la
// extensión» de `CLAUDE.md`): un bucle de 19 archivos con `setTimeout(0)`
// entre cada uno tardaría 19 minutos en una pestaña de fondo y parecería
// colgado. Un `MessageChannel` no se clampea.
//
// 🟩 **El import COMPLETO ya no congela el cartel (v=297)**: hasta v=296 su
// `onProgress` era `async` con un `await` que nadie esperaba. Ahora
// `processStreamingHistory()` es `async` y cede ella misma, y `handleFiles()`
// le pasa esta misma `cederElHilo()`: hay UN solo `MessageChannel` para los
// dos caminos.

/** Cede el hilo de verdad, también en una pestaña oculta. */
function cederElHilo() {
  return new Promise(resolve => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
    ch.port2.postMessage(0);
  });
}

const SOLO_DIAS_ID = 'import-solo-dias-overlay';

/**
 * Abre el selector de archivos y carga ÚNICAMENTE el detalle por día.
 *
 * Acepta el ZIP entero o los `Streaming_History_Audio_*.json` sueltos — el
 * mismo selector de siempre.
 *
 * @returns {Promise<{ok: boolean, days?: object, ms?: number, crudas?: number}>}
 */
function importarSoloElDetalle() {
  return new Promise((resolve) => {
    let resuelto = false;
    const terminar = (v) => { if (resuelto) return; resuelto = true; resolve(v); };

    const ov = openModal({
      id: SOLO_DIAS_ID,
      onClose: () => terminar({ ok: false }),
      html: `
      <div class="modal ih-modal" style="max-width:560px;width:min(560px,94vw)">
        <div class="ih-header">
          <div class="ih-header-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <div style="flex:1;min-width:0">
            <h3 style="margin:0;font-size:17px">El detalle por día</h3>
            <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px">Solo qué sonó cada día — no toca el resto de tu historial</div>
          </div>
          <button class="btn btn-secondary btn-sm ih-close-btn" data-close-modal title="Cerrar" aria-label="Cerrar">✕</button>
        </div>

        <label id="isd-drop" class="ih-drop">
          <input type="file" id="isd-file" accept=".zip,application/zip,.json,application/json" multiple style="display:none">
          <div class="ih-drop-title">Arrastra tu ZIP aquí</div>
          <div class="ih-drop-sub">o haz click para elegir · ZIP entero o JSONs sueltos</div>
        </label>

        <div id="isd-status" class="ih-status" aria-live="polite"></div>

        <p class="olm-note">Se guarda <strong>en este navegador</strong> y no se publica en ningún sitio:
        el detalle por día dice qué escuchaste cada día, y eso no viaja a ninguna parte.</p>
      </div>
    `,
    });

    const estado = ov.querySelector('#isd-status');
    const poner = (html, mal = false) => {
      estado.className = 'ih-status active' + (mal ? ' error' : '');
      estado.innerHTML = html;
    };
    const drop = ov.querySelector('#isd-drop');
    const input = ov.querySelector('#isd-file');
    drop.onclick = () => input.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('dragging'); };
    drop.ondragleave = () => drop.classList.remove('dragging');
    drop.ondrop = (e) => {
      e.preventDefault();
      drop.classList.remove('dragging');
      if (e.dataTransfer.files?.length) correr([...e.dataTransfer.files]);
    };
    input.onchange = (e) => { if (e.target.files?.length) correr([...e.target.files]); };

    async function correr(files) {
      const t0 = Date.now();
      let utiles;
      try {
        utiles = await archivosDeAudio(files, poner);
      } catch (e) {
        poner(`Error: ${escapeHtml(e.message)}`, true);
        return;
      }
      if (!utiles) return;

      const acu = crearAcumuladorDeDias();
      let crudas = 0;
      for (let i = 0; i < utiles.length; i++) {
        poner(`<span class="spinner" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:6px"></span> ` +
              `Archivo ${i + 1} de ${utiles.length} · ${crudas.toLocaleString('es-ES')} reproducciones`);
        // Ceder ANTES de bloquear: así el texto de arriba llega a pintarse.
        await cederElHilo();
        let arr;
        try {
          arr = JSON.parse(await readFileText(utiles[i]));
        } catch (e) {
          poner(`Error parseando ${escapeHtml(utiles[i].name)}: ${escapeHtml(e.message)}`, true);
          return;
        }
        crudas += acu.agregarArchivo(arr).crudas;
        arr = null;   // soltarlo antes de pedir el siguiente
      }

      poner(`<span class="spinner" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:6px"></span> ` +
            `Guardando ${crudas.toLocaleString('es-ES')} reproducciones…`);
      await cederElHilo();

      let days;
      try {
        days = acu.cerrar();
        await guardarSoloDias(days);
      } catch (e) {
        poner(`Error guardando: ${escapeHtml(e.message)}`, true);
        return;
      }
      const ms = Date.now() - t0;
      closeById(SOLO_DIAS_ID);
      showToast(`Detalle por día cargado · ${Object.keys(days.dias).length.toLocaleString('es-ES')} días en ${(ms / 1000).toFixed(1)} s`, 'success');
      terminar({ ok: true, days, ms, crudas });
    }
  });
}

/**
 * Los `Streaming_History_Audio_*.json` de lo que haya elegido el usuario, ya
 * sea el ZIP o los sueltos. Es el MISMO filtro que el import completo — y por
 * eso vive acá, al lado, en vez de en otro archivo.
 */
async function archivosDeAudio(files, poner) {
  let jsonFiles = [];
  const zip = files.find(f => f.name.toLowerCase().endsWith('.zip'));
  const jsons = files.filter(f => f.name.toLowerCase().endsWith('.json'));
  if (zip) {
    poner(`<span class="spinner" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:6px"></span> Descomprimiendo ZIP…`);
    jsonFiles = await extractHistoryJsons(zip);
  } else if (jsons.length) {
    jsonFiles = jsons;
  } else {
    poner('Ningún archivo válido. Necesito el ZIP entero o los <code>Streaming_History_Audio_*.json</code>.', true);
    return null;
  }
  const utiles = jsonFiles.filter(f => /Streaming_History_Audio.*\.json$/i.test(f.name || ''));
  if (!utiles.length) {
    poner('No encontré ningún <code>Streaming_History_Audio_*.json</code>. Necesitas el <em>Extended Streaming History</em>.', true);
    return null;
  }
  // Por nombre, que es el orden en el que el export los numera. Da igual para
  // el resultado —el acumulador se queda con el `ts` mínimo de cada tema— pero
  // hace que el progreso avance de forma previsible.
  utiles.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return utiles;
}

export { openImportHistory, importarSoloElDetalle };
