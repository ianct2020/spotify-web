const BASE = 'https://musicbrainz.org/ws/2';
const UA = 'spotify-tools/1.0 (github.com/ianct2020/spotify-web)';
const MIN_INTERVAL_MS = 1100;

let _lastReq = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, _lastReq + MIN_INTERVAL_MS - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastReq = Date.now();
}

async function mbFetch(path) {
  await throttle();
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': UA,
    },
  });
  if (res.status === 503) {
    await new Promise(r => setTimeout(r, 5000));
    throw new Error('MusicBrainz throttled (503), reintentar después');
  }
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}`);
  return res.json();
}

async function searchArtist(name) {
  const q = encodeURIComponent(`artist:"${name}"`);
  const data = await mbFetch(`/artist/?query=${q}&limit=1&fmt=json`);
  return data.artists?.[0] || null;
}

async function getArtistDetail(mbid) {
  return mbFetch(`/artist/${mbid}?inc=genres+tags&fmt=json`);
}

async function getGenresForArtist(name) {
  const found = await searchArtist(name);
  if (!found) return { source: 'musicbrainz', tags: [], notFound: true };
  const detail = await getArtistDetail(found.id);
  const rawGenres = (detail.genres || []).map(g => ({
    name: String(g.name).toLowerCase(),
    count: g.count || 0,
  }));
  const rawTags = (detail.tags || []).map(t => ({
    name: String(t.name).toLowerCase(),
    count: t.count || 0,
  }));
  const merged = new Map();
  for (const g of rawGenres) merged.set(g.name, (merged.get(g.name) || 0) + g.count + 10);
  for (const t of rawTags) merged.set(t.name, (merged.get(t.name) || 0) + t.count);
  const tags = [...merged.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  return { source: 'musicbrainz', tags, mbid: found.id, notFound: false };
}

export { getGenresForArtist, searchArtist, getArtistDetail };
