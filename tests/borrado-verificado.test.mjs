// El borrado verificado compartido (2026-08-29).
//
// El bug de fondo: de las cinco vistas que borran me gusta, sólo #versions
// verificaba, y su verificación fallaba en silencio. Ahora la secuencia
// (registro → DELETE → verificación) vive en un solo sitio.
//
// Lo que este test afirma:
//   - que NINGÚN fallo de verificación se puede leer como éxito, y
//   - que la guarda del último ejemplar, cuando se declara, corre de verdad y
//     ANTES del DELETE (o sea: aborta sin haber tocado nada).
//
// Correr con: node tests/borrado-verificado.test.mjs

import { borrarLikesVerificado } from '../src/js/util/borrado-verificado.js';
import { indexarBiblioteca } from '../src/js/util/versions-guard.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
async function tira(fn, re, label) {
  try { await fn(); ok(false, `${label} (no tiró)`); }
  catch (e) { ok(re.test(e.message), `${label} — «${e.message.slice(0, 70)}…»`); }
}

// Dobles: registran qué se llamó, para poder afirmar «no se borró nada».
function espias({ contains = null, containsTira = null } = {}) {
  const log = { borrados: null, opciones: null, verificados: null };
  return {
    log,
    removeLikedTracks: async (ids, opts) => { log.borrados = [...ids]; log.opciones = opts; },
    checkLibraryContains: async (ids) => {
      log.verificados = [...ids];
      if (containsTira) throw new Error(containsTira);
      if (contains) return contains(ids);
      return new Map(ids.map(id => [id, false])); // salieron todas
    },
  };
}
const sinGuarda = { guarda: 'ninguna', motivoSinGuarda: 'test' };

console.log('\n1) Camino feliz');
{
  const e = espias();
  const r = await borrarLikesVerificado(['a', 'b'], { origen: '#test', ...e, ...sinGuarda });
  ok(r.pedidos === 2 && r.salieron === 2, 'devuelve 2 pedidas / 2 salidas');
  ok(e.log.opciones.origen === '#test', 'le pasa el origen a removeLikedTracks (registro v=162)');
  ok(e.log.verificados.length === 2, 'verifica las 2');
}

console.log('\n2) La verificación NO puede fallar en silencio');
{
  const e = espias({ containsTira: 'boom 429' });
  await tira(() => borrarLikesVerificado(['a'], { origen: '#test', ...e, ...sinGuarda }),
    /no se pudo verificar/i, 'si contains tira, la operación tira');
  ok(e.log.borrados !== null, 'y dice la verdad: el borrado YA se había mandado');
}
{
  // El caso exacto del 28/08: el borrado se manda y las pistas siguen dentro.
  const e = espias({ contains: (ids) => new Map(ids.map((id, i) => [id, i === 0])) });
  await tira(() => borrarLikesVerificado(['a', 'b'], { origen: '#test', ...e, ...sinGuarda }),
    /1 de 2 pista\(s\) siguen en tu biblioteca/, 'si alguna sigue dentro, tira y dice cuántas');
}
{
  // Una respuesta CORTA no se puede leer como «no está»: ese es el modo de
  // fallo que hizo pasar por bueno el chunk de 50.
  const e = espias({ contains: (ids) => new Map([[ids[0], false]]) });
  await tira(() => borrarLikesVerificado(['a', 'b', 'c'], { origen: '#test', ...e, ...sinGuarda }),
    /Verificación incompleta: pedí 3 ids y volvieron 1/, 'respuesta corta ≠ pistas ausentes');
}

console.log('\n3) La declaración de guarda es obligatoria y real');
{
  const e = espias();
  await tira(() => borrarLikesVerificado(['a'], { origen: '#test', ...e }),
    /hay que declarar «guarda»/, 'sin declarar guarda, no borra');
  ok(e.log.borrados === null, 'y no llamó a removeLikedTracks');
}
await tira(() => borrarLikesVerificado(['a'], { origen: '#test', ...espias(), guarda: 'ninguna' }),
  /exige motivoSinGuarda/, '«ninguna» sin motivo por escrito, no borra');
await tira(() => borrarLikesVerificado(['a'], { origen: '#test', ...espias(), guarda: 'ultimo-ejemplar' }),
  /exige items y libraryByKey/, 'declarar la guarda sin datos para comprobarla, no borra');
await tira(() => borrarLikesVerificado(['a'], { ...espias(), ...sinGuarda }),
  /falta «origen»/, 'sin origen no hay registro, y sin registro no borra');

console.log('\n4) La guarda del último ejemplar aborta ANTES del DELETE');
{
  const tk = (id, name, artist, album) => ({ track: { id, name, artists: [{ name: artist }], album: { name: album } } });
  const biblio = [tk('t1', 'Song A', 'Artista', 'Álbum'), tk('t2', 'Song A', 'Artista', 'Deluxe'), tk('t3', 'Song B', 'Artista', 'Otro')];
  const idx = indexarBiblioteca(biblio);
  const e = espias();

  // Borrar t2 deja t1 viva: pasa.
  const r = await borrarLikesVerificado(['t2'], {
    origen: '#versions', ...e, guarda: 'ultimo-ejemplar', items: [biblio[1]], libraryByKey: idx,
  });
  ok(r.salieron === 1, 'borrar una de dos copias pasa la guarda');

  // Borrar t3 la deja en cero: el caso de las 123.
  const e2 = espias();
  await tira(() => borrarLikesVerificado(['t3'], {
    origen: '#versions', ...e2, guarda: 'ultimo-ejemplar', items: [biblio[2]], libraryByKey: idx,
  }), /sin ninguna copia viva/, 'borrar la única copia se aborta');
  ok(e2.log.borrados === null, 'y NO se mandó ningún DELETE — «no se tocó nada» es literal');
  ok(e2.log.verificados === null, 'ni se llegó a verificar');
}

console.log('\n5) Detalles que descuadran el conteo');
{
  const e = espias();
  // #skips expande a todas las versiones del tema y dos filas pueden compartir
  // una: si el duplicado llegara al conteo, la verificación acusaría un fallo
  // inexistente.
  const r = await borrarLikesVerificado(['a', 'a', 'b', null, ''], { origen: '#skips', ...e, ...sinGuarda });
  ok(r.pedidos === 2, 'deduplica y descarta vacíos antes de contar');
  ok(e.log.borrados.length === 2, 'y manda 2 ids, no 5');
}
{
  const e = espias();
  const r = await borrarLikesVerificado([], { origen: '#test', ...e, ...sinGuarda });
  ok(r.pedidos === 0 && e.log.borrados === null, 'lista vacía: no llama a nadie');
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} ok, ${failed} fallidos\n`);
process.exit(failed === 0 ? 0 : 1);
