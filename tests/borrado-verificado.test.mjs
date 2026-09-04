// El borrado verificado compartido (2026-08-29).
//
// El bug de fondo: de las cinco vistas que borran me gusta, sólo #versions
// verificaba, y su verificación fallaba en silencio. Ahora la secuencia
// (registro → DELETE → verificación) vive en un solo sitio.
//
// Lo que este test afirma:
//   - que NINGÚN fallo de verificación se puede leer como éxito,
//   - que la guarda del último ejemplar, cuando se declara, corre de verdad y
//     ANTES del DELETE (o sea: aborta sin haber tocado nada), y
//   - que la OTRA MITAD de esa guarda se comprueba: después del borrado, que la
//     que se queda siga en la biblioteca de verdad (2026-09-03). La guarda se
//     apoyaba en un índice en memoria armado en el análisis; esto pregunta.
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
// `vivas` son los ids que la biblioteca todavía tiene: las que se quedan. Todo
// lo demás vuelve false, que es «salió».
function espias({ contains = null, containsTira = null, tiraEn = 1, vivas = [] } = {}) {
  const log = { borrados: null, opciones: null, verificados: null, supervivientesVerificados: null, llamadas: 0 };
  return {
    log,
    removeLikedTracks: async (ids, opts) => { log.borrados = [...ids]; log.opciones = opts; },
    checkLibraryContains: async (ids) => {
      log.llamadas++;
      if (log.llamadas === 1) log.verificados = [...ids];
      else log.supervivientesVerificados = [...ids];
      if (containsTira && log.llamadas === tiraEn) throw new Error(containsTira);
      if (contains) return contains(ids);
      return new Map(ids.map(id => [id, vivas.includes(id)]));
    },
  };
}
const sinGuarda = { guarda: 'ninguna', motivoSinGuarda: 'test' };
// Una superviviente cualquiera, con la forma que manda #versions.
const SUP = (id, nombre = 'Song A', grupo = 'Song A — Artista') =>
  ({ id, nombre, artista: 'Artista', album: 'Álbum', grupo });

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
{
  const tk = (id, name) => ({ track: { id, name, artists: [{ name: 'Artista' }], album: { name: 'Álbum' } } });
  const idx = indexarBiblioteca([tk('t1', 'Song A'), tk('t2', 'Song A')]);
  const e = espias({ vivas: ['t1'] });
  await tira(() => borrarLikesVerificado(['t2'], {
    origen: '#versions', ...e, guarda: 'ultimo-ejemplar', items: [tk('t2', 'Song A')], libraryByKey: idx,
  }), /exige «supervivientes»/, 'declarar la guarda sin decir qué sobrevive, no borra');
  ok(e.log.borrados === null, 'y no llamó a removeLikedTracks');
  await tira(() => borrarLikesVerificado(['a'], {
    origen: '#skips', ...espias(), ...sinGuarda, supervivientes: [SUP('x')],
  }), /no admite «supervivientes»/, 'y guarda «ninguna» no acepta supervivientes: ahí quedarse en cero es lo pedido');
}
await tira(() => borrarLikesVerificado(['a'], { ...espias(), ...sinGuarda }),
  /falta «origen»/, 'sin origen no hay registro, y sin registro no borra');

console.log('\n4) La guarda del último ejemplar aborta ANTES del DELETE');
{
  const tk = (id, name, artist, album) => ({ track: { id, name, artists: [{ name: artist }], album: { name: album } } });
  const biblio = [tk('t1', 'Song A', 'Artista', 'Álbum'), tk('t2', 'Song A', 'Artista', 'Deluxe'), tk('t3', 'Song B', 'Artista', 'Otro')];
  const idx = indexarBiblioteca(biblio);
  const e = espias({ vivas: ['t1'] });

  // Borrar t2 deja t1 viva: pasa.
  const r = await borrarLikesVerificado(['t2'], {
    origen: '#versions', ...e, guarda: 'ultimo-ejemplar', items: [biblio[1]], libraryByKey: idx,
    supervivientes: [SUP('t1')],
  });
  ok(r.salieron === 1, 'borrar una de dos copias pasa la guarda');
  ok(r.supervivientes === 1, 'y devuelve cuántas se comprobó que se quedaron');

  // Borrar t3 la deja en cero: el caso de las 123.
  const e2 = espias();
  await tira(() => borrarLikesVerificado(['t3'], {
    origen: '#versions', ...e2, guarda: 'ultimo-ejemplar', items: [biblio[2]], libraryByKey: idx,
    // Superviviente de OTRA canción: la guarda razona por canción, y t3 sigue
    // quedándose en cero copias aunque el lote tenga marcadas en otro grupo.
    supervivientes: [SUP('t1')],
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

console.log('\n6) La que SE QUEDA se comprueba después del borrado');
{
  const tk = (id, name) => ({ track: { id, name, artists: [{ name: 'Artista' }], album: { name: 'Álbum' } } });
  const biblio = [tk('t1', 'Song A'), tk('t2', 'Song A')];
  const idx = indexarBiblioteca(biblio);
  const conGuarda = (e, sup) => borrarLikesVerificado(['t2'], {
    origen: '#versions', ...e, guarda: 'ultimo-ejemplar', items: [biblio[1]], libraryByKey: idx,
    supervivientes: sup,
  });

  // El caso: la guarda pasa —t1 está en el índice del análisis— pero t1 ya no
  // está en Spotify. Antes de esto salía el toast verde «1 de 1 salieron».
  {
    const e = espias({ vivas: [] });
    await tira(() => conGuarda(e, [SUP('t1', 'Song A')]),
      /YA NO ESTÁN/, 'si la que se queda no está, TIRA (no hay camino verde)');
    ok(e.log.supervivientesVerificados?.[0] === 't1', 'y preguntó por ella a Spotify, no al caché');
  }
  {
    // Nombre y grupo en el mensaje: «avisar con nombre y apellido».
    const e = espias({ vivas: [] });
    let err = null;
    try { await conGuarda(e, [SUP('t1', 'Wish You Were Here', 'Wish You Were Here — Pink Floyd')]); }
    catch (x) { err = x; }
    ok(/Wish You Were Here/.test(err.message), 'el mensaje lleva el nombre del tema');
    ok(/grupo: Wish You Were Here — Pink Floyd/.test(err.message), 'y de qué grupo era');
    ok(Array.isArray(err.supervivientesPerdidas) && err.supervivientesPerdidas[0].id === 't1',
      'y el error lleva el detalle estructurado, para avisar sin re-parsear la frase');
  }
  {
    // Si no se puede comprobar, tampoco vale por bueno: el mismo criterio que
    // con las que salen. `tiraEn: 2` = falla la segunda llamada, la nuestra.
    const e = espias({ containsTira: 'boom 429', tiraEn: 2, vivas: ['t1'] });
    await tira(() => conGuarda(e, [SUP('t1')]),
      /NO se pudo comprobar/, 'si la comprobación falla, tira en vez de asumir');
  }
  {
    // Una respuesta corta acá tampoco puede leerse como «está»: es el mismo
    // fallo de los chunks de 50 mirado desde el otro lado.
    const e = espias({ contains: (ids) => ids.length === 1 ? new Map([[ids[0], false]]) : new Map() });
    await tira(() => conGuarda(e, [SUP('t1'), SUP('t9', 'Song Z')]),
      /Comprobación incompleta de las que se quedan/, 'respuesta corta ≠ superviviente viva');
  }
  {
    // Y la contradicción en los términos: la que se queda, en la lista de
    // borrado. Aborta antes de tocar nada.
    const e = espias({ vivas: ['t1'] });
    await tira(() => borrarLikesVerificado(['t1', 't2'], {
      origen: '#versions', ...e, guarda: 'ultimo-ejemplar', items: [biblio[0], biblio[1]], libraryByKey: idx,
      supervivientes: [SUP('t1')],
    }), /marcadas para quedarse estaban en la lista de borrado/, 'superviviente en la lista de borrado: aborta');
    ok(e.log.borrados === null, 'y no se mandó ningún DELETE');
  }
  {
    const e = espias({ vivas: ['t1'] });
    const r = await conGuarda(e, [SUP('t1')]);
    ok(r.salieron === 1 && r.supervivientes === 1, 'camino feliz: salió la sobrante y la marcada sigue ahí');
    ok(e.log.llamadas === 2, 'son dos preguntas distintas a la biblioteca, no una');
  }
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} ok, ${failed} fallidos\n`);
process.exit(failed === 0 ? 0 : 1);
