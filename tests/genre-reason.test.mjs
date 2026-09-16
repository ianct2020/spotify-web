// Suite de la auditoría de #genre (v=222).
//
// La pregunta que contesta la vista nueva es «¿qué tag concreto hizo entrar a
// este track en este grupo?». Lo que estas pruebas cuidan es que la respuesta
// sea RECONSTRUIBLE y no una segunda opinión: `bucketFor` es la misma función
// que usa `buildGenreMap` para repartir, así que reason ⊆ reparto por
// construcción. Si alguien vuelve a escribir el criterio a mano en by-genre.js
// —que es exactamente el error que costó la tanda de v=219— estas pruebas
// siguen pasando y la app miente, así que la garantía real es el import único.
// Lo que sí se puede probar acá es la simetría en los dos modos del toggle y
// que el orden de los motivos se respeta.

import assert from 'node:assert';
import { bucketFor, reasonsFor, tallyReasons } from '../src/js/util/genre-reason.js';

let n = 0;
const eq = (a, b, msg) => { n++; assert.strictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };
const deep = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };

// ── 1. El toggle manda: el mismo tag cae en buckets distintos ────────────────

eq(bucketFor('indie rock', true), 'Rock', 'agrupando, indie rock → Rock');
eq(bucketFor('indie rock', false), 'indie rock', 'sin agrupar, el bucket ES el tag');
eq(bucketFor('trap', true), 'Hip-Hop / Rap', 'trap vive en Hip-Hop / Rap');
eq(bucketFor('trap', false), 'trap', 'sin agrupar, trap es su propio bucket');

// Un tag que no está en ninguna lista se queda tal cual en los DOS modos.
eq(bucketFor('vaporwave nocturno', true), 'vaporwave nocturno', 'tag desconocido no se inventa grupo');
eq(bucketFor('vaporwave nocturno', false), 'vaporwave nocturno', 'ni sin agrupar');

// ── 2. El motivo: qué tags del artista lo metieron ahí ───────────────────────

const travis = ['trap', 'hip hop', 'rap', 'psychedelic'];

deep(reasonsFor(travis, 'Hip-Hop / Rap', true), ['trap', 'hip hop', 'rap'],
  'los tres tags de rap explican la entrada a Hip-Hop / Rap');
deep(reasonsFor(travis, 'Rock', true), ['psychedelic'],
  'y «psychedelic» solo es lo que lo mete en Rock — el caso a auditar');

// Sin agrupar, un track entra a un bucket por UN tag y nada más: el suyo.
deep(reasonsFor(travis, 'trap', false), ['trap'], 'sin agrupar la razón es el tag mismo');
deep(reasonsFor(travis, 'Rock', false), [], 'y «Rock» no es bucket de nadie sin agrupar');

// El orden que llega de Last.fm es el de popularidad y se conserva: el primer
// chip de la fila es el tag con más peso, no uno cualquiera.
deep(reasonsFor(['rap', 'trap'], 'Hip-Hop / Rap', true), ['rap', 'trap'], 'orden de Last.fm, tal cual');
deep(reasonsFor(['trap', 'rap'], 'Hip-Hop / Rap', true), ['trap', 'rap'], 'y al revés también');

// Repetidos con distinta caja cuentan una sola vez: si no, un artista con
// «Rap» y «rap» pintaría dos chips iguales.
deep(reasonsFor(['Rap', 'rap', 'RAP'], 'Hip-Hop / Rap', true), ['Rap'], 'un solo chip por tag');

// ── 3. Entradas rotas no tiran la vista ─────────────────────────────────────

deep(reasonsFor(undefined, 'Rock', true), [], 'artista sin tags en caché → sin motivo');
deep(reasonsFor(null, 'Rock', true), [], 'ni con null');
deep(reasonsFor([], 'Rock', true), [], 'ni con la lista vacía');

// ── 4. El recuento por tag ──────────────────────────────────────────────────

const filas = [
  { reasons: ['rock', 'grunge'] },
  { reasons: ['rock'] },
  { reasons: ['grunge'] },
  { reasons: ['rock'] },
  { reasons: [] },
];
deep(tallyReasons(filas), [['rock', 3], ['grunge', 2]], 'ordenado por cuántos metió cada tag');

// ⚠️ La suma de los motivos NO es el total de tracks, porque un track con dos
// razones suma en las dos. El rótulo de la vista tiene que decir el total
// aparte, y por eso «Todos» lleva su propio número.
eq(tallyReasons(filas).reduce((s, [, c]) => s + c, 0), 5, 'los motivos suman 5');
eq(filas.length, 5, 'pero los tracks son 5 — la coincidencia es casual, no una identidad');

deep(tallyReasons([]), [], 'sin filas no hay recuento');
deep(tallyReasons([{ reasons: [] }]), [], 'ni con filas sin motivo');

// ── 5. Los empates se desempatan alfabéticamente, no por orden de llegada ───

deep(tallyReasons([{ reasons: ['zeta'] }, { reasons: ['alfa'] }]), [['alfa', 1], ['zeta', 1]],
  'empate a 1 → alfabético, para que la fila de chips no baile entre repintados');

console.log(`✔ genre-reason: ${n} asserts OK`);
