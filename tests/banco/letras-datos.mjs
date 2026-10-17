// Los datos del banco de letras (v=311, tanda 59): temas, me gusta y un lrclib
// SIMULADO. 🔴 Todo INVENTADO: el repo es público y una letra de verdad es texto
// con derechos de autor. Nada de esto sale a `lrclib.net`.

export const ARTISTA = 'Banda Inventada';

// Ids de 22 caracteres, como los de Spotify (el contrato del doble).
const id = (n, c) => `${n}${c}${c.toUpperCase()}`.repeat(8).slice(0, 22);
export const TEMAS = {
  faro:     { id: id(1, 'a'), name: 'Canción del Faro' },     // B y F: 200, la tuya dura 3 s más → aviso
  silencio: { id: id(2, 'b'), name: 'Tema Sin Letra' },       // C: 404 y, al «Buscar de nuevo», 200
  ocupado:  { id: id(3, 'c'), name: 'Tema Ocupado Uno' },     // D: 503 y después 200
  caido:    { id: id(4, 'd'), name: 'Tema Caído Dos' },       // D: 503 y 503
  ajeno:    { id: id(5, 'e'), name: 'Tema Prestado' },        // E: un 200 de OTRO artista
  cercano:  { id: id(6, 'f'), name: 'Tema Cercano' },         // F: la tuya dura 1 s más → sin aviso
  lento:    { id: id(7, 'g'), name: 'Tema Que Tarda' },       // G: la respuesta en vuelo al cerrar
  largo:    { id: id(8, 'h'), name: 'Tema de Sesenta Renglones' }, // M y las fotos: 60 renglones
};
export const IMG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#556"/></svg>');
export const pedidoDe = (t) => ({ id: t.id, name: t.name, artists: [ARTISTA], img: IMG });

// Duraciones (lrclib manda segundos; el me gusta, ms).
export const DUR_LRCLIB = 200;
export const DUR_LIKE = { faro: 203000, cercano: 201000, largo: 222000 };

// Una letra INVENTADA de N renglones, sincronizada (con marcas) y plana.
export function letraInventada(n, sincro = false) {
  const r = [];
  for (let i = 1; i <= n; i++) {
    const t = i % 9 === 0 ? '' : `Renglón inventado número ${i} de la canción`;
    r.push(sincro ? `[${String(Math.floor(i * 3 / 60)).padStart(2, '0')}:${String((i * 3) % 60).padStart(2, '0')}.${String(i % 100).padStart(2, '0')}] ${t}`.trimEnd() : t);
  }
  return r.join('\n');
}

const ok = (t, extra = {}) => ({
  status: 200,
  cuerpo: {
    id: 1000 + Object.keys(TEMAS).indexOf(Object.keys(TEMAS).find((k) => TEMAS[k] === t)),
    name: t.name, trackName: t.name, artistName: ARTISTA, albumName: 'Disco Inventado',
    duration: DUR_LRCLIB, instrumental: false, hasWordSync: false,
    plainLyrics: null, syncedLyrics: letraInventada(8, true), lyricsfile: null, ...extra,
  },
});
const no = { status: 404, cuerpo: { code: 404, name: 'TrackNotFound', message: 'Failed to find specified track' } };
const ocupado = { status: 503, cuerpo: { message: 'banco: lrclib ocupado' }, retryAfter: '1' };

// Lo que contesta el lrclib simulado, por título: una cola (el último se repite).
function guion() {
  return {
    [TEMAS.faro.name]: [ok(TEMAS.faro)],
    [TEMAS.silencio.name]: [no, ok(TEMAS.silencio)],
    [TEMAS.ocupado.name]: [ocupado, ok(TEMAS.ocupado)],
    [TEMAS.caido.name]: [ocupado, ocupado, ok(TEMAS.caido)],
    [TEMAS.ajeno.name]: [ok(TEMAS.ajeno, { artistName: 'Grupo Ajeno Inventado' })],
    [TEMAS.cercano.name]: [ok(TEMAS.cercano)],
    [TEMAS.lento.name]: ['colgada'],
    [TEMAS.largo.name]: [ok(TEMAS.largo, { plainLyrics: letraInventada(60), syncedLyrics: null })],
  };
}

// El lrclib de mentira: registra cada petición (url, marco, método, cabeceras) y
// contesta según el guion. 'colgada' no contesta hasta que alguien llame a
// `soltar()` (para la respuesta en vuelo de G).
export function crearLrclib() {
  const colas = guion();
  const reg = [];
  const colgadas = [];
  return {
    reg,
    colgadas,
    soltar() { for (const c of colgadas.splice(0)) c(ok(TEMAS.lento)); },
    pedidasDe: (t) => reg.filter((r) => new URL(r.url).searchParams.get('track_name') === t.name).length,
    responder(url, info) {
      reg.push({ url, ...info });
      const u = new URL(url);
      const cola = colas[u.searchParams.get('track_name')];
      if (!cola) return Promise.resolve(no);
      const r = cola.length > 1 ? cola.shift() : cola[0];
      if (r === 'colgada') return new Promise((res) => colgadas.push(res));
      return Promise.resolve(r);
    },
  };
}

export function likesInventados() {
  return Object.entries(TEMAS).map(([k, t], i) => ({
    added_at: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
    track: {
      id: t.id, uri: `spotify:track:${t.id}`, name: t.name, popularity: 50,
      duration_ms: DUR_LIKE[k] ?? 180000, explicit: false, is_playable: true, track_number: i + 1,
      artists: [{ id: '0aAaAaAaAaAaAaAaAaAaAa', name: ARTISTA }],
      album: { id: '9zZzZzZzZzZzZzZzZzZzZz', name: 'Disco Inventado', release_date: '2020-01-01', album_type: 'album', total_tracks: 8, images: [] },
    },
  }));
}

// El historial del DUEÑO para la ficha (tanda 60, `letras-caso.html?uid=owner`), INVENTADO:
// los totales y el detalle por mes de cada tema, con la forma que leen `loadTrackPlays()`
// (`tracks[id] = [plays, segundos]`, más `albums`) y `loadTrackDetail()`
// (`tracks[id] = { m, f, l, d, x }`). Con esto la ficha pinta los cuatro números, las fechas
// y la curva de 200 px, que es lo que el modal del dueño tiene de más.
export function historialDuenio() {
  const plays = { tracks: {}, albums: [] };
  const detail = { tracks: {} };
  Object.values(TEMAS).forEach((t, i) => {
    const m = {};
    for (let a = 2019; a <= 2024; a++) for (let mes = 1; mes <= 12; mes++) {
      const n = (a * 7 + mes * 3 + i) % 11;
      if (n > 2) m[`${a}-${String(mes).padStart(2, '0')}`] = n;
    }
    const total = Object.values(m).reduce((s, n) => s + n, 0);
    plays.tracks[t.id] = [total, total * 200];
    detail.tracks[t.id] = { m, f: '2019-01-05', l: '2024-12-20', d: Math.round(total * 0.8), x: 9 };
  });
  return { plays, detail };
}
