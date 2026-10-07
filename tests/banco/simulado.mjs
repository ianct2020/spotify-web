// Red de Spotify SIMULADA para los bancos que corren la app real (v=275).
//
// POR QUÉ EXISTE: las tres cosas de v=275 son vistas que, abiertas de verdad,
// cuestan peticiones que el encargo no deja gastar (`#sync` baja ~9.500 likes y
// una playlist entera; `#new-releases` dispara el reconcilio de ocultos;
// `#similar` resuelve cada tema con `/search`), y una de ellas ESCRIBE en la
// cuenta. Lo que se necesita ver es el comportamiento del código real, no el de
// Spotify, así que se le da al código real una Spotify de mentira:
//
//   · un token-sombra en localStorage, para que `getValidToken()` no salga a la red;
//   · un `window.fetch` que contesta las rutas que el escenario declara,
//     REGISTRA cada petición y cada ESCRITURA (POST/PUT/DELETE), y **nunca llama
//     al `fetch` original para api.spotify.com** — lo desconocido se contesta con
//     un error y queda anotado en `desconocidas`;
//   · nada de esto llega a Spotify, ni lee ni escribe: «0 escrituras reales» no
//     es una promesa, es que este archivo no tiene el camino.
//
// ⚠️ Un doble tiene que cumplir el contrato del servicio que reemplaza (ver
// `tests/dobles/api-doble.mjs`): acá se rechazan los `limit` que la API real
// rechazaría.

const TOPES = { '/search': 10, '/albums': 50, '/playlists': 100, '/me': 50 };

export function instalarRedSimulada() {
  const reg = {
    llamadas: [],        // { metodo, ruta }
    escrituras: [],      // las que no son GET, con su cuerpo
    desconocidas: [],    // lo que ninguna ruta atendió
    externas: [],        // fuera de api.spotify.com, que ni siquiera se intentan
  };
  const rutas = [];      // [{ metodo, patron:RegExp, responder:(m, url, cuerpo)=>objeto|{status,body} }]
  const externas = [];   // dobles de hosts que NO son Spotify (Last.fm), declarados a mano
  const original = window.fetch.bind(window);
  window.__fetchOriginal = original;

  localStorage.setItem('sp_access_token', 'tok-del-banco');
  localStorage.setItem('sp_refresh_token', 'ref-del-banco');
  localStorage.setItem('sp_token_expiry', String(Date.now() + 6 * 60 * 60 * 1000));

  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

  window.fetch = async (entrada, opciones = {}) => {
    const url = typeof entrada === 'string' ? entrada : entrada.url;
    const metodo = String(opciones.method || (typeof entrada === 'object' && entrada.method) || 'GET').toUpperCase();
    const abs = new URL(url, location.href);

    // Lo del propio banco (módulos, css, datos de src/): sí pasa.
    if (abs.origin === location.origin) return original(entrada, opciones);

    if (abs.hostname !== 'api.spotify.com') {
      // Un host externo DECLARADO por el escenario (Last.fm, para #similar) se
      // contesta de mentira igual que Spotify. Lo que no se declaró sigue
      // bloqueado y anotado: la regla de «esto no tiene camino a la red real»
      // no cambia, solo se le pueden agregar dobles explícitos.
      for (const r of externas) {
        if (r.patron.test(abs.href)) {
          reg.llamadas.push({ metodo, ruta: abs.href });
          return json(await r.responder({ url: abs, metodo }) ?? {});
        }
      }
      reg.externas.push(`${metodo} ${abs.href}`);
      return json({ error: { status: 599, message: 'banco: red externa bloqueada' } }, 599);
    }

    const ruta = abs.pathname.replace(/^\/v1/, '') + abs.search;
    const base = '/' + abs.pathname.replace(/^\/v1\//, '').split('/')[0];
    const lim = abs.searchParams.get('limit');
    if (lim != null && TOPES[base] && (+lim < 1 || +lim > TOPES[base])) {
      return json({ error: { status: 400, message: 'Invalid limit' } }, 400);
    }
    const cuerpo = opciones.body ? (() => { try { return JSON.parse(opciones.body); } catch { return opciones.body; } })() : null;
    reg.llamadas.push({ metodo, ruta });
    if (metodo !== 'GET') reg.escrituras.push({ metodo, ruta, cuerpo });

    for (const r of rutas) {
      if (r.metodo !== metodo || !r.patron.test(ruta)) continue;
      const salida = await r.responder({ ruta, url: abs, cuerpo, metodo });
      if (salida && salida.__status) return json(salida.body ?? {}, salida.__status);
      return json(salida ?? {});
    }
    reg.desconocidas.push(`${metodo} ${ruta}`);
    return json({ error: { status: 404, message: `banco: ruta sin simular (${metodo} ${ruta})` } }, 404);
  };

  return {
    reg,
    /** Declara una ruta: `ruta('GET', /^\/me$/, () => ({...}))`. La última declarada gana. */
    ruta(metodo, patron, responder) { rutas.unshift({ metodo, patron, responder }); },
    /** Declara un doble de un host externo por URL completa (p. ej. Last.fm). */
    rutaExterna(patron, responder) { externas.unshift({ patron, responder }); },
    sinSimular: (status = 404) => ({ __status: status, body: { error: { status, message: 'banco' } } }),
    restaurar() { window.fetch = original; },
  };
}

// ── Los datos de mentira (el repo es público: nada de esto es de nadie) ───────

// ⚠️ Los ids son de 22 caracteres alfanuméricos, como los de Spotify de verdad.
// Eran `art-a`…`art-d` hasta v=276 y eso ROMPÍA el contrato del doble: hay código
// que valida la forma del id (`artistasDeBases` descarta con
// `/^[a-zA-Z0-9]{22}$/` lo que no la cumple, para no mandarle basura a
// `/me/library/contains`), así que con los ids viejos #follow-artists salía
// vacía en el banco por una razón que la app real nunca tendría. Un doble que no
// cumple el contrato del servicio que reemplaza prueba otra cosa.
export const ARTISTAS = [
  { id: '0aAaAaAaAaAaAaAaAaAaAa', name: 'Artista de ejemplo A' },
  { id: '1bBbBbBbBbBbBbBbBbBbBb', name: 'Artista de ejemplo B' },
  { id: '2cCcCcCcCcCcCcCcCcCcCc', name: 'Artista de ejemplo C' },
  { id: '3dDdDdDdDdDdDdDdDdDdDd', name: 'Artista de ejemplo D' },
];

/** 12 me gusta por artista (48): pasan el umbral de 10+ likes de #new-releases. */
export function crearLikes() {
  const items = [];
  ARTISTAS.forEach((a, i) => {
    for (let k = 1; k <= 12; k++) {
      items.push({
        added_at: new Date(Date.UTC(2025, 0, 1 + i * 12 + k)).toISOString(),
        track: {
          id: `l-${a.id}-${k}`, uri: `spotify:track:l-${a.id}-${k}`, name: `Tema ${k} de ${a.name.slice(-1)}`,
          popularity: 50, duration_ms: 200000, explicit: false, is_playable: true, track_number: k,
          artists: [{ id: a.id, name: a.name }],
          album: { id: `la-${a.id}`, name: `Álbum guardado de ${a.name.slice(-1)}`, release_date: '2020-01-01', album_type: 'album', total_tracks: 12, images: [] },
        },
      });
    }
  });
  return items;
}

export function pistaPlaylist(t) {
  return { added_at: t.added_at, item: { ...t.track, type: 'track' } };
}

/**
 * Espera una condición SIN apostar al reloj virtual.
 *
 * ⚠️ Medido en v=275: bajo `--virtual-time-budget` el reloj corre más rápido que
 * el IndexedDB real. `esperarA` (esperar.mjs) mide su tope con `performance.now()`,
 * que es el virtual, y los 10 s del tope se gastaban en microsegundos de pared
 * mientras la primera lectura de IDB seguía pendiente: el banco fallaba una de
 * cada dos corridas con «0 llamadas», sin que la app tuviera nada que ver. Una
 * petición HTTP local pendiente SÍ detiene el reloj virtual, así que cada vuelta
 * hace una (al propio servidor del banco, 0 contra Spotify) y el tope se cuenta
 * en VUELTAS, no en milisegundos.
 */
export async function esperarReal(condicion, { que, vueltas = 1200 } = {}) {
  for (let i = 0; i < vueltas; i++) {
    let v;
    try { v = condicion(); } catch { v = false; }
    if (v) return v;
    await (window.__fetchOriginal || fetch)('/banco/esperar.mjs', { cache: 'no-store' }).then(r => r.text()).catch(() => {});
    await new Promise(r => setTimeout(r, 8));
  }
  throw new Error(`BANCO: se agotaron ${vueltas} vueltas esperando «${que}». La captura NO se hizo: habría mentido.`);
}

/** Espera una promesa (p. ej. una escritura de IndexedDB) sin que el reloj virtual
 *  la deje atrás: mismo motivo y mismo remedio que `esperarReal`. */
export async function anclar(promesa, { vueltas = 2000 } = {}) {
  let hecho = false, valor, error;
  promesa.then(v => { hecho = true; valor = v; }, e => { hecho = true; error = e; });
  await esperarReal(() => hecho, { que: 'una escritura de IndexedDB', vueltas });
  if (error) throw error;
  return valor;
}
