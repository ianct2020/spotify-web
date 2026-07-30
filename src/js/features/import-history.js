// UI de importación del Extended Streaming History (BYOH — Bring Your Own).
// Acepta ZIP del export de Spotify o los Streaming_History_Audio_*.json sueltos.
// Extrae + procesa + guarda todo en el IDB del user (nada sale de su compu).

import { processStreamingHistory } from '../history-processor.js';
import { saveMyHistory, clearMyHistory, hasLocalHistory } from './history-data.js';
import { escapeHtml, showProgress, hideProgress, confirmModal, alertModal } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

let overlay = null;

function close() {
  overlay?.remove();
  overlay = null;
}

async function openImportHistory() {
  close();
  const alreadyHas = await hasLocalHistory();

  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'import-history-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:540px;width:min(540px,92vw)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <h3 style="margin:0;font-size:18px">Cargar mi historial de Spotify</h3>
        <button class="btn btn-secondary btn-sm" id="ih-close" title="Cerrar">✕</button>
      </div>
      <p style="color:var(--color-text-secondary);font-size:13px;margin:0 0 14px">
        Arrastrá el <strong>ZIP</strong> del <em>Extended Streaming History</em> tal como te lo mandó Spotify — o los archivos <code>Streaming_History_Audio_*.json</code> sueltos. Todo se procesa <strong>en tu navegador</strong>: nada se sube a ningún lado.
      </p>

      <label id="ih-drop" style="display:block;border:2px dashed var(--color-border);border-radius:var(--radius-md,10px);padding:28px 16px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s">
        <input type="file" id="ih-file" accept=".zip,application/zip,.json,application/json" multiple style="display:none">
        <div style="font-size:14px;color:var(--color-text)">Arrastrá acá o hacé click para elegir</div>
        <div style="font-size:12px;color:var(--color-text-muted);margin-top:6px">ZIP (my_spotify_data.zip) o JSONs sueltos</div>
      </label>

      <div id="ih-status" style="margin-top:14px;font-size:13px;color:var(--color-text-secondary);min-height:20px"></div>

      ${alreadyHas ? `
        <div style="border-top:1px solid var(--color-border);margin-top:16px;padding-top:14px">
          <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:8px">Ya tenés historial cargado localmente:</div>
          <button class="btn btn-danger btn-sm" id="ih-clear">Borrar mi historial local</button>
        </div>
      ` : ''}
    </div>
  `;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.body.appendChild(overlay);

  overlay.querySelector('#ih-close').onclick = close;

  const drop = overlay.querySelector('#ih-drop');
  const input = overlay.querySelector('#ih-file');
  drop.onclick = () => input.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.style.borderColor = 'var(--color-accent)'; drop.style.background = 'var(--color-accent-soft)'; };
  drop.ondragleave = () => { drop.style.borderColor = ''; drop.style.background = ''; };
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.style.borderColor = ''; drop.style.background = '';
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
  const setStatus = (html) => { if (status) status.innerHTML = html; };

  let jsonFiles = [];
  const zip = files.find(f => f.name.toLowerCase().endsWith('.zip'));
  const jsons = files.filter(f => f.name.toLowerCase().endsWith('.json'));

  if (zip) {
    setStatus(`<span class="spinner" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:6px"></span> Descomprimiendo ZIP…`);
    try {
      jsonFiles = await extractHistoryJsons(zip);
    } catch (e) {
      setStatus(`<span style="color:var(--color-error)">Error descomprimiendo: ${escapeHtml(e.message)}</span>`);
      return;
    }
  } else if (jsons.length) {
    jsonFiles = jsons;
  } else {
    setStatus('<span style="color:var(--color-error)">Ningún archivo válido. Necesito el ZIP entero o los Streaming_History_Audio_*.json</span>');
    return;
  }

  const useful = jsonFiles.filter(f => /Streaming_History_Audio.*\.json$/i.test(f.name || ''));
  if (!useful.length) {
    setStatus(`<span style="color:var(--color-error)">No encontré ningún Streaming_History_Audio_*.json en lo que subiste. Asegurate de descargar el <em>Extended Streaming History</em>, no el Account Data básico.</span>`);
    return;
  }

  setStatus(`Leyendo ${useful.length} archivo${useful.length === 1 ? '' : 's'}…`);

  const arrays = [];
  for (const f of useful) {
    const text = await readFileText(f);
    try {
      arrays.push(JSON.parse(text));
    } catch (e) {
      setStatus(`<span style="color:var(--color-error)">Error parseando ${escapeHtml(f.name)}: ${escapeHtml(e.message)}</span>`);
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
