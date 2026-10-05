// Genera el banco del inicio a partir del app.js REAL (no de una copia a mano).
//
// Por qué se genera en vez de escribirse: si el banco tuviera su propia copia de
// HOME_SECTIONS, mediría una grilla que no es la que se despliega — justo el
// defecto que esta tanda viene a cerrar (el inicio y el menú eran dos listas
// separadas y divergieron). Acá la única fuente es `src/js/app.js`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
// Permite generar el banco de OTRA copia del repo (p. ej. una versión vieja
// extraída con `git archive`), para comparar antes/después en igualdad.
const base = process.argv[2] ? resolve(process.argv[2]) : raiz;
const src = readFileSync(join(base, 'src/js/app.js'), 'utf8');

const ICONS = {};
const bloque = src.match(/^const ICONS = \{(.*?)^\};/ms)[1];
for (const m of bloque.matchAll(/^  ([a-zA-Z0-9]+): '(.*)',$/gm)) ICONS[m[1]] = m[2];

// El menú lateral: ruta, icono y rótulo, tal como los pinta showApp().
const menu = [];
for (const m of src.matchAll(/<div class="sidebar-section-title">([^<]+)<\/div>|data-route="([^"]+)" href="#[^"]*">\s*<span class="nav-link-icon">(.*?)<\/span>\s*([^\n<]*)/gs)) {
  if (m[1]) { menu.push({ grupo: m[1].trim() }); continue; }
  if (m[2] === 'home') continue;
  const ic = m[3].trim();
  const svg = ic.startsWith('${ICONS.') ? ICONS[ic.slice(8, -1)] : ic;
  menu.push({ ruta: m[2], icono: svg, rotulo: (m[4] || '').trim() });
}

const hs = src.match(/^const HOME_SECTIONS = \[(.*?)^\];/ms)[1];
const secciones = [];
for (const sec of hs.split(/\{\s*\n\s*title: '/).slice(1)) {
  const titulo = sec.match(/^([^']*)'/)[1];
  const items = [...sec.matchAll(/\{ hash: '([^']+)', icon: ICONS\.([a-zA-Z0-9]+), name: '([^']+)', desc: '([^']*)' \}/g)]
    .map(m => ({ hash: m[1], icono: m[2], nombre: m[3], desc: m[4] }));
  secciones.push({ titulo, items });
}

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Banco — el inicio</title>
<!-- EL ORDEN IMPORTA y es el mismo que src/index.html: components.css ANTES
     que main.css. Las clases .card y .home-card tienen la misma especificidad
     (una clase), así que lo que decide es cuál se carga después. Con el orden
     invertido el banco medía un padding de 24 px que en la app real es de 16:
     mentía el banco, no la app. -->
<link rel="stylesheet" href="../../src/css/theme.css">
<link rel="stylesheet" href="../../src/css/components.css">
<link rel="stylesheet" href="../../src/css/main.css">
<style>body{margin:0}</style>
</head><body>
<div class="app" style="display:flex">
  <aside class="sidebar">
    <div class="sidebar-header"><span class="sidebar-title">Fonoteca</span></div>
    <nav class="sidebar-nav">
${menu.map(e => e.grupo
  ? `      <div class="sidebar-section"><div class="sidebar-section-title">${e.grupo}</div>`
  : `        <a class="nav-link" data-route="${e.ruta}" href="#${e.ruta}"><span class="nav-link-icon">${e.icono}</span> ${e.rotulo}</a>`
).join('\n')}
      </div>
    </nav>
  </aside>
  <main class="main" id="main-content">
    <div class="page-header"><h1>Bienvenido</h1></div>
${secciones.map(s => `    <div class="home-section">
      <div class="sidebar-section-title" style="margin-bottom:12px">${s.titulo}</div>
      <div class="home-grid">
${s.items.map(it => `        <a href="#${it.hash}" class="card home-card" data-route="${it.hash}" title="${it.desc}">
          <div class="home-card-icon">${ICONS[it.icono]}</div>
          <h3 class="home-card-name">${it.nombre}</h3>
          <p class="home-card-desc">${it.desc}</p>
        </a>`).join('\n')}
      </div>
    </div>`).join('\n')}
  </main>
</div>
</body></html>`;

writeFileSync(join(base, 'tests/banco/inicio.html'), html);
console.log(`banco del inicio generado: ${secciones.length} grupos, ${secciones.reduce((n,s)=>n+s.items.length,0)} tarjetas`);
