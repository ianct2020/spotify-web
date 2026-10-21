// Los me gusta INVENTADOS del banco `versiones-deluxe` (tanda 70). El repo es
// público: nada de esto es de nadie.
//
// Seis grupos de #versions (el mismo tema likeado dos veces), cada uno con UNA
// cosa distinta, más dos fantasmas y relleno para que la descarga sea de dos
// páginas:
//
//   G1 «pasa»       el disco y su deluxe: misma grabación, el deluxe con más pistas;
//   G2 «remaster»   un lado con «- Remastered 2011» en el título;
//   G3 «duración»   duran 3 s distinto;
//   G4 «empate»     las dos ediciones con las mismas pistas;
//   G5 «single»     el disco sin cola es un single (`album_type: 'single'`);
//   G6 «oculto»     pasaría, pero está oculto («no es duplicado»).
//
// Solo G1 tiene propuesta. Los ids son de 22 caracteres alfanuméricos, como los
// de Spotify (el contrato del doble: ver `simulado.mjs`).

const ARTISTA = { id: 'artFicticio00000000000A', name: 'Artista Ficticio' };
const idDe = (s) => (s.replace(/[^a-zA-Z0-9]/g, '') + '0'.repeat(22)).slice(0, 22);

function pista(id, { name, disco, discoId, tipo = 'album', pistas, dur = 200000, explicit = false, isrc = 'QZFIC2500001', alta = '2025-03-01' }) {
  return {
    added_at: `${alta}T12:00:00Z`,
    track: {
      id: idDe(id), uri: `spotify:track:${idDe(id)}`, name, popularity: null, duration_ms: dur, explicit, is_playable: true,
      track_number: 1, external_ids: isrc ? { isrc } : undefined,
      artists: [{ id: ARTISTA.id, name: ARTISTA.name }],
      album: { id: idDe(discoId), name: disco, release_date: '2020-01-01', album_type: tipo, total_tracks: pistas, images: [] },
    },
  };
}

export const GRUPOS = {
  pasa: [
    pista('g1base', { name: 'Tema Que Pasa', disco: 'Disco Ficticio', discoId: 'albG1base', pistas: 10, dur: 200000 }),
    pista('g1deluxe', { name: 'Tema Que Pasa', disco: 'Disco Ficticio (Deluxe Edition)', discoId: 'albG1deluxe', pistas: 16, dur: 200400 }),
  ],
  remaster: [
    pista('g2base', { name: 'Tema Brillante', disco: 'Disco Dos', discoId: 'albG2base', pistas: 10, isrc: 'QZFIC2500002' }),
    pista('g2remaster', { name: 'Tema Brillante - Remastered 2011', disco: 'Disco Dos (Deluxe)', discoId: 'albG2deluxe', pistas: 14, isrc: 'QZFIC2500002' }),
  ],
  duracion: [
    pista('g3base', { name: 'Tema Que Dura Distinto', disco: 'Disco Tres', discoId: 'albG3base', pistas: 10, dur: 200000, isrc: null }),
    pista('g3deluxe', { name: 'Tema Que Dura Distinto', disco: 'Disco Tres (Deluxe)', discoId: 'albG3deluxe', pistas: 15, dur: 203000, isrc: null }),
  ],
  empate: [
    pista('g4base', { name: 'Tema Empatado', disco: 'Disco Cuatro', discoId: 'albG4base', pistas: 12, isrc: 'QZFIC2500004' }),
    pista('g4deluxe', { name: 'Tema Empatado', disco: 'Disco Cuatro (Deluxe)', discoId: 'albG4deluxe', pistas: 12, isrc: 'QZFIC2500004' }),
  ],
  single: [
    pista('g5single', { name: 'Tema Del Single', disco: 'Disco Cinco', discoId: 'albG5single', tipo: 'single', pistas: 3, isrc: 'QZFIC2500005' }),
    pista('g5deluxe', { name: 'Tema Del Single', disco: 'Disco Cinco (Deluxe)', discoId: 'albG5deluxe', pistas: 15, isrc: 'QZFIC2500005' }),
  ],
  oculto: [
    pista('g6base', { name: 'Tema Oculto', disco: 'Disco Seis', discoId: 'albG6base', pistas: 9, isrc: 'QZFIC2500006' }),
    pista('g6deluxe', { name: 'Tema Oculto', disco: 'Disco Seis (Deluxe)', discoId: 'albG6deluxe', pistas: 14, isrc: 'QZFIC2500006' }),
  ],
};

// La clave de #versions del grupo oculto, escrita a mano (`normalizeKey`: artista y
// título en minúsculas): el banco tiene que poder correr contra un `src/` viejo.
export const CLAVE_OCULTO = 'artista ficticio|||tema oculto';

function fantasma(n) {
  return {
    added_at: '2025-02-01T12:00:00Z',
    track: {
      id: idDe(`fantasma${n}`), uri: `spotify:track:${idDe(`fantasma${n}`)}`, name: '', duration_ms: 0, explicit: false, is_playable: false,
      artists: [{ id: 'artVacio00000000000000', name: '' }],
      album: { id: idDe(`albfantasma${n}`), name: '', release_date: '0000', album_type: 'album', total_tracks: 14, images: [] },
    },
  };
}

function relleno(n) {
  return pista(`relleno${n}`, { name: `Relleno ${n}`, disco: `Disco Relleno ${n}`, discoId: `albrelleno${n}`, pistas: 8, isrc: `QZFIC25R${String(n).padStart(4, '0')}`, alta: '2024-06-01' });
}

/** 54 me gusta: 12 de los grupos, 2 fantasmas y 40 de relleno (dos páginas de 50). */
export function likesInventados() {
  return [
    ...Object.values(GRUPOS).flat(),
    fantasma(1), fantasma(2),
    ...Array.from({ length: 40 }, (_, i) => relleno(i + 1)),
  ];
}

/**
 * La Spotify simulada de #versions sobre `sim` (`instalarRedSimulada()`): `/me`,
 * `/me/tracks` paginado, y la biblioteca: `DELETE /me/library?uris=…` la saca del
 * conjunto y `GET /me/library/contains?uris=…` contesta por cada uri. Nada sale a
 * la red: lo registra `sim.reg`.
 */
export function crearSpotify(sim, { uid = 'usuarioDelBancoVersiones' } = {}) {
  const likes = likesInventados();
  const enLaBiblioteca = new Set(likes.map(l => l.track.uri));
  sim.ruta('GET', /^\/me$/, () => ({ id: uid, display_name: 'Banco' }));
  sim.ruta('GET', /^\/me\/tracks/, ({ url }) => {
    const off = +url.searchParams.get('offset') || 0, lim = +url.searchParams.get('limit') || 50;
    const vivos = likes.filter(l => enLaBiblioteca.has(l.track.uri));
    return { items: vivos.slice(off, off + lim), total: vivos.length, next: off + lim < vivos.length ? 'x' : null };
  });
  sim.ruta('DELETE', /^\/me\/library\?uris=/, ({ url }) => {
    for (const u of (url.searchParams.get('uris') || '').split(',')) enLaBiblioteca.delete(u);
    return {};
  });
  sim.ruta('GET', /^\/me\/library\/contains\?uris=/, ({ url }) =>
    (url.searchParams.get('uris') || '').split(',').map(u => enLaBiblioteca.has(u)));
  return { likes, enLaBiblioteca };
}
