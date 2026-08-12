// UI de importación del Extended Streaming History (BYOH — Bring Your Own).
// Acepta ZIP del export de Spotify o los Streaming_History_Audio_*.json sueltos.
// Extrae + procesa + guarda todo en el IDB del user (nada sale de su compu).

import { processStreamingHistory } from '../history-processor.js?v=134';
import { saveMyHistory, clearMyHistory, hasLocalHistory } from './history-data.js?v=134';
import { escapeHtml, showProgress, hideProgress, confirmModal, alertModal } from '../ui/components.js?v=134';
import { showToast } from '../ui/toast.js?v=134';
import { openModal, closeTop, closeById } from '../ui/modal-stack.js?v=134';

const OVERLAY_ID = 'import-history-overlay';
let overlay = null;

function close() {
  if (closeById(OVERLAY_ID)) {
    overlay = null;
  }
}

async function openImportHistory() {
  close();
  const alreadyHas = await hasLocalHistory();

  overlay = openModal({
    id: OVERLAY_ID,
    onClose: () => { overlay = null; },
    html: `
    <div class="modal ih-modal" style="max-width:560px;width:min(560px,94vw)">
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
      </div>

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
        <div class="ih-drop-title">Arrastrá tu ZIP acá</div>
        <div class="ih-drop-sub">o hacé click para elegir · ZIP entero o JSONs sueltos</div>
      </label>

      <div id="ih-status" class="ih-status" aria-live="polite"></div>

      <details class="ih-howto">
        <summary>Cómo conseguir el ZIP <span class="ih-howto-hint">(si todavía no lo tenés)</span></summary>
        <ol>
          <li>Andá a <a href="https://www.spotify.com/account/privacy/" target="_blank" rel="noopener">spotify.com/account/privacy</a> con tu cuenta.</li>
          <li>Bajá hasta <strong>«Descargar tus datos»</strong>.</li>
          <li>Marcá <strong>Historial de reproducción ampliado</strong> y confirmá.</li>
          <li>Esperá el mail (unos días). Cuando llegue, descargás el ZIP y lo subís acá.</li>
        </ol>
        <button class="btn btn-secondary btn-sm" data-open-spotify-privacy>Abrir Privacidad de Spotify ↗</button>
      </details>

      ${alreadyHas ? `
        <div class="ih-clear-section">
          <div style="font-size:12px;color:var(--color-text-muted)">
            Ya tenés historial cargado en este browser
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
    const ok = await confirmModal('Borrar tu historial local', 'Vas a borrar los agregados de tu Extended Streaming History guardados en este browser. No afecta tu cuenta de Spotify ni el ZIP que descargaste — podés volver a subirlo cuando quieras.', 'Borrar');
    if (!ok) return;
    await clearMyHistory();
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
    setStatus('No encontré ningún <code>Streaming_History_Audio_*.json</code>. Necesitás el <em>Extended Streaming History</em> (el que tarda días), no el Account Data básico.', 'error');
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
    // El procesamiento es CPU intensivo y sincrónico. Cedo el thread cada tanto
    // llamando a onProgress que refresca el overlay.
    const start = Date.now();
    let lastYield = start;
    result = processStreamingHistory(arrays, {
      onProgress: async ({ phase, loaded, total }) => {
        const label = phase === 'dedup' ? 'Leyendo plays…' : 'Calculando agregados…';
        showProgress(label, loaded, total);
        const now = Date.now();
        if (now - lastYield > 100) {
          lastYield = now;
          await new Promise(r => setTimeout(r, 0)); // yield al event loop
        }
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
  showToast(`Historial cargado: ${totals.plays_valid.toLocaleString('es-AR')} plays válidas · ${totals.days_active.toLocaleString('es-AR')} días activos`, 'success');
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
      throw new Error('ZIP64 no soportado (el export es demasiado grande para descomprimir en el browser). Probá desempaquetar y subir los .json sueltos.');
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

export { openImportHistory };
