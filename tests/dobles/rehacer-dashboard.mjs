// Doble para `tests/rehacer-me-gusta.test.mjs` y `tests/rehacer-me-gusta-corte.test.mjs` (v=349, tanda 106).
//
// Saca del FUENTE de `features/dashboard.js` el `loadData` REAL y, si existe, el handler REAL de «Rehacer me gusta desde
// Spotify» (`handleRehacerLikes`, con su estado de módulo), y los arma con `new Function` sobre los dobles que le pasa el
// test (el molde de `importar-a-medias`, que saca `handleImportTodo`). Importar `dashboard.js` entero arrastraría veinte
// módulos con DOM; lo que se prueba son estas dos funciones.
//
// `loadData` se arma con otro nombre y se envuelve: así el test ve lo que DEVUELVE también cuando la llama el handler.
//
// El DOM de mentira (`crearDom`) registra cada escritura (`innerHTML` y `textContent`) con si el nodo estaba en el
// documento. Un `innerHTML` nuevo desengancha a los hijos del anterior, como el de verdad: `getElementById` ya no los
// encuentra, y escribir en ellos queda anotado como escritura en un nodo fuera del documento.
//
// (v=350, tanda 107) Los nodos saben `querySelector('#id')` sobre sus descendientes, para el `loadData` que busca sus
// botones dentro de `#dash-content` y no en el documento. El test lo pueden apuntar a otro fuente (`sacarDelFuente`).

import { readFileSync, existsSync } from 'node:fs';

export function sacarDelFuente(rutaDashboard) {
  const dash = existsSync(rutaDashboard) ? readFileSync(rutaDashboard, 'utf8') : '';
  const uno = (re) => (dash.match(re) || [''])[0];
  return {
    dash,
    loadData: uno(/async function loadData\([^)]*\) \{[\s\S]*?\n}\n/),
    handler: uno(/async function handleRehacerLikes\(\) \{[\s\S]*?\n}\n/),
    estado: [uno(/let _rehaciendo = [^\n]*\n/), uno(/const TEXTO_YA_BAJANDO = [^\n]*\n/)].join(''),
  };
}

const DEPS = ['getAllLikedTracks', 'getBestAvailableLikes', 'hayCargaDeLikesEnVuelo', 'alertModal', 'infoModal', 'showToast',
  'escapeHtml', 'computeStats', 'renderDashboard', 'refreshLastSyncLabel', 'renderStartScreen', 'vigilarRuta',
  'diferenciaDeLikes', 'urisDeLikes', 'textoConfirmacionRehacer', 'textoFinalRehacer', 'document', 'console', 'alLlamarLoadData'];

/** Arma las dos funciones con `deps`. `handleRehacerLikes` es `null` si el fuente no la tiene. */
export function armar(textos, deps) {
  const loadData = textos.loadData.replace('async function loadData(', 'async function __loadDataReal(');
  const cuerpo = `const { ${DEPS.join(', ')} } = deps;
let charts = [];
let _loadController = null;
let _lastStats = null;
let _lastContainer = null;
${textos.estado}
${loadData}
function loadData(...a) { const p = __loadDataReal(...a); if (alLlamarLoadData) alLlamarLoadData(a, p); return p; }
${textos.handler}
return { loadData, handleRehacerLikes: ${textos.handler ? 'handleRehacerLikes' : 'null'} };`;
  return new Function('deps', cuerpo)({ alLlamarLoadData: null, ...deps });
}

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function crearDom() {
  const registro = new Map();
  const escrituras = [];
  class El {
    constructor(id, padre) { this.id = id; this.padre = padre; this.hijos = []; this._html = ''; this._texto = ''; this.style = {}; this.onclick = null; this.raiz = false; this.fuera = false; }
    get isConnected() { for (let e = this; e; e = e.padre) { if (e.fuera) return false; if (e.raiz) return true; } return false; }
    set innerHTML(h) {
      for (const c of this.hijos) desenganchar(c);
      this.hijos = [];
      this._html = String(h);
      escrituras.push({ id: this.id, que: 'innerHTML', valor: this._html, conectado: this.isConnected });
      for (const m of this._html.matchAll(/\bid="([^"]+)"/g)) { const c = new El(m[1], this); this.hijos.push(c); registro.set(m[1], c); }
    }
    get innerHTML() { return this._html; }
    set textContent(t) { this._texto = String(t); escrituras.push({ id: this.id, que: 'textContent', valor: this._texto, conectado: this.isConnected }); }
    get textContent() { return this._texto; }
    /** (v=350) Solo `#id`, y busca entre los descendientes de este nodo, esté o no en el documento (como el de verdad). */
    querySelector(sel) {
      const id = String(sel).replace(/^#/, '');
      for (const c of this.hijos) { if (c.id === id) return c; const d = c.querySelector(sel); if (d) return d; }
      return null;
    }
  }
  function desenganchar(e) { e.fuera = true; if (registro.get(e.id) === e) registro.delete(e.id); for (const c of e.hijos) desenganchar(c); }
  const main = new El('main-content', null);
  main.raiz = true;
  registro.set('main-content', main);
  const document = { getElementById: (id) => { const e = registro.get(id); return e && e.isConnected ? e : null; } };
  return {
    document, escrituras,
    /** Lo que pinta `render()` de #dashboard, en lo que toca a estas dos funciones. */
    montarDashboard() { main.innerHTML = '<div id="dash-content"></div><div id="dash-last-sync"></div>'; },
    /** El router cambia de ruta: `#main-content` pasa a ser otra vista. Devuelve desde qué escritura mirar. */
    cambiarDeRuta() { main.innerHTML = '<div id="vista-nueva"><p id="vista-nueva-texto"></p></div>'; return escrituras.length; },
    /** Lo que se escribió en un nodo que está en el documento desde la escritura `desde`. */
    escriturasEnElDocumento(desde) { return escrituras.slice(desde).filter((x) => x.conectado); },
    /** Lo que pintó `loadData` en `#dash-content` (cada `innerHTML`, en orden). */
    pintadoEnContenido() { return escrituras.filter((x) => x.id === 'dash-content' && x.que === 'innerHTML').map((x) => x.valor); },
    boton(id) { return registro.get(id) || null; },
  };
}
