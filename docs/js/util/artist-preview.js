// Preview de artista con las canciones de Ian, no con el hit global (v=150).
//
// Hasta v=149 el hover sobre un artista sonaba `getArtistTopPreview(nombre)`:
// una búsqueda de iTunes solo por artista, que devuelve su tema **más
// conocido**. Para «Eric Clapton» eso es *Wonderful Tonight*, que puede no
// tener nada que ver con lo que Ian escucha de él.
//
// Lo pedido: que suene una pista SUYA que esté en los likes de Ian, al azar. Si
// no tiene ninguna en likes, una de sus 10-15 más escuchadas del historial. El
// hit global queda de último recurso, para artistas que no están en ninguna de
// las dos fuentes (los de «Similares», «Rabbit hole», «Recomendaciones»).
//
// El debounce de 400 ms lo pone `attachHover` (ui/preview-player.js), así que
// barrer una lista de artistas con el mouse no dispara ninguna búsqueda.

import { getPreview, getArtistTopPreview } from '../api/preview-providers.js?v=186';
import { getBestAvailableLikes } from '../api.js?v=186';
import { loadArtistTracks } from '../features/history-data.js?v=186';
import { artistNames } from './artist-name.js?v=186';
import { albumKey } from './album-key.js?v=186';

// Cuántas de las más escuchadas entran en el sorteo cuando no hay likes.
const TOP_HISTORIAL = 15;

// Cuántas pistas distintas probamos antes de rendirnos. Un artista puede tener
// 40 likes y que el primero sorteado no esté en iTunes ni en Deezer; sin este
// tope, un artista sin previews haría 40 búsquedas por hover.
const MAX_INTENTOS = 3;

// ── Índice de likes por artista ─────────────────────────────────────────────
//
// Se arma una vez y se reusa. Ojo con el patrón de `ensureLikedIndex` de
// W-Three: **un índice vacío NO se memoiza**. Si el caché de likes todavía no
// estaba cuando se armó, memoizarlo dejaría todos los hovers de la sesión
// cayendo al hit global aunque los likes llegaran un segundo después.
let _porArtista = null;
let _promesa = null;

function indexar(items) {
  const mapa = new Map();   // nombre en minúsculas → [{name, id}]
  for (const it of items) {
    const t = it?.track;
    if (!t?.name) continue;
    for (const nombre of artistNames(t)) {
      const k = nombre.toLowerCase();
      let lista = mapa.get(k);
      if (!lista) { lista = []; mapa.set(k, lista); }
      lista.push({ name: t.name, id: t.id || null, artists: artistNames(t) });
    }
  }
  return mapa;
}

async function likesPorArtista() {
  if (_porArtista) return _porArtista;
  if (_promesa) return _promesa;
  _promesa = (async () => {
    let mapa = new Map();
    try {
      const { items } = await getBestAvailableLikes();
      mapa = indexar(items || []);
    } catch (e) {
      console.warn('[artist-preview] no pude leer los likes:', e.message);
    }
    _promesa = null;
    if (mapa.size === 0) return mapa;   // vacío: no se memoiza, se reintenta
    _porArtista = mapa;
    return mapa;
  })();
  return _promesa;
}

/** Se llama al cambiar de usuario o al re-sincronizar los likes. */
export function resetArtistPreviewIndex() {
  _porArtista = null;
  _promesa = null;
}

// ── El sorteo ───────────────────────────────────────────────────────────────

// Memoria corta de lo último que sonó por artista, para que dos hovers seguidos
// sobre el mismo nombre no repitan la misma canción.
const ultima = new Map();

function sortear(candidatas, nombre) {
  if (candidatas.length <= 1) return candidatas.slice();
  const previa = ultima.get(nombre.toLowerCase());
  const pool = candidatas.filter(c => c.name !== previa);
  const base = pool.length ? pool : candidatas.slice();
  // Fisher-Yates parcial: alcanza con barajar, después se prueban en orden.
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base;
}

async function candidatasDelHistorial(nombre) {
  try {
    const idx = await loadArtistTracks();
    const artistas = idx?.artists;
    if (!artistas) return [];
    // El índice está keyeado por el nombre exacto del historial; la ficha puede
    // llegar con otra capitalización.
    let clave = artistas[nombre] ? nombre : null;
    if (!clave) {
      const bajo = nombre.toLowerCase();
      clave = Object.keys(artistas).find(k => k.toLowerCase() === bajo) || null;
    }
    if (!clave) return [];
    // Cada entrada es [nombre, plays, min, id]; vienen ordenadas por plays.
    return (artistas[clave] || [])
      .slice(0, TOP_HISTORIAL)
      .map(([name, , , id]) => ({ name, id: id || null, artists: [nombre] }));
  } catch {
    return [];
  }
}

/**
 * Preview de una pista del artista, priorizando lo que Ian escucha.
 *
 * @param {string} nombre
 * @returns {Promise<object|null>} el mismo shape que devuelve `getPreview`
 */
export async function getArtistLikePreview(nombre) {
  if (!nombre) return null;
  const clave = nombre.toLowerCase();

  // 1) Sus pistas en los likes de Ian.
  const mapa = await likesPorArtista();
  let candidatas = mapa.get(clave) || [];
  let fuente = 'likes';

  // 2) Si no tiene ninguna, sus más escuchadas del historial.
  if (!candidatas.length) {
    candidatas = await candidatasDelHistorial(nombre);
    fuente = 'historial';
  }

  for (const c of sortear(candidatas, nombre).slice(0, MAX_INTENTOS)) {
    const res = await getPreview({
      name: c.name,
      artists: c.artists?.length ? c.artists : [nombre],
      spotifyId: c.id || undefined,
    });
    if (res) {
      ultima.set(clave, c.name);
      return { ...res, fuenteArtista: fuente };
    }
  }

  // 3) Último recurso: el hit del artista según iTunes/Deezer. Es lo único que
  //    hay para artistas que Ian todavía no escuchó (Similares, Rabbit hole).
  return await getArtistTopPreview(nombre);
}

/**
 * Lo mismo pero para un ÁLBUM: una pista de ese disco que esté en los likes de
 * Ian, al azar. Si no tiene ninguna, cae al preview del artista.
 *
 * Lo usa el hover de «Top álbumes» del Wrapped, que hasta v=149 no tenía hover
 * ninguno (`hoverKey: null`): la fila «Eric Clapton — Eric Clapton» no sonaba, y
 * tampoco ninguna de las otras catorce.
 *
 * @param {string} album
 * @param {string} artista
 */
export async function getAlbumLikePreview(album, artista) {
  if (!album && !artista) return null;
  const objetivo = albumKey(album || '', artista || '');

  let candidatas = [];
  try {
    const { items } = await getBestAvailableLikes();
    for (const it of (items || [])) {
      const t = it?.track;
      if (!t?.name || !t.album?.name) continue;
      if (albumKey(t.album.name, artistNames(t)[0] || '') !== objetivo) continue;
      candidatas.push({ name: t.name, id: t.id || null, artists: artistNames(t) });
    }
  } catch (e) {
    console.warn('[artist-preview] no pude leer los likes del álbum:', e.message);
  }

  const etiqueta = `${album}|${artista}`;
  for (const c of sortear(candidatas, etiqueta).slice(0, MAX_INTENTOS)) {
    const res = await getPreview({
      name: c.name,
      artists: c.artists?.length ? c.artists : [artista],
      spotifyId: c.id || undefined,
    });
    if (res) {
      ultima.set(etiqueta.toLowerCase(), c.name);
      return { ...res, fuenteArtista: 'likes-album' };
    }
  }

  return artista ? await getArtistLikePreview(artista) : null;
}
