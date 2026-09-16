// Suite del resolutor único de id de álbum (v=219).
//
// Lo que estas pruebas cuidan NO es que se acepten más álbumes: es que el
// candidato equivocado se RECHACE. El fallo que las trajo era mudo — pedir
// «Harry's House» y que `/search` devolviera el disco de versiones al piano da
// un tracklist entero de sufijos « - Piano Version» con cara de resultado
// correcto, porque `normText` borra los paréntesis y los dos nombres normalizan
// igual.
//
// La regla es la SIMÉTRICA de `versionesCompatibles()` de util/track-match.js
// y va al revés a propósito: para pistas, un pedido sin versión acepta
// cualquiera; para álbumes, un pedido sin versión RECHAZA al que trae versión.
// Las dos direcciones están probadas acá abajo, una al lado de la otra, para
// que quede claro que la divergencia es deliberada.

import assert from 'node:assert';
import { marcadoresDeVersion, candidatoTraeVersionDeMas, MARCADORES_TRIBUTO } from '../src/js/util/album-version-guard.js';
import { titleMatches } from '../src/js/util/track-match.js';
import { albumKey } from '../src/js/util/album-key.js';

let n = 0;
const eq = (a, b, msg) => { n++; assert.strictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };
const rechaza = (pedido, cand, msg) => eq(candidatoTraeVersionDeMas(pedido, cand), true, msg);
const acepta = (pedido, cand, msg) => eq(candidatoTraeVersionDeMas(pedido, cand), false, msg);

// ── 1. El caso que trajo la tanda ────────────────────────────────────────────

rechaza("Harry's House", "Harry's House (Piano Version)", 'el disco de piano no es Harry\'s House');
rechaza("Harry's House", "Harry's House [Instrumental]", 'ni el instrumental');
rechaza("Harry's House", "Harry's House - Karaoke Version", 'ni el karaoke');
acepta("Harry's House", "Harry's House", 'el disco original sí');
acepta("Harry's House", "Harry's House (Deluxe)", 'un deluxe es el MISMO disco, no otra versión');
acepta("Harry's House", "Harry's House (Remastered)", 'un remaster es la misma grabación');

// ── 2. Vocabulario de tributo — el que no existía en ninguna parte ───────────

rechaza('The New Toronto', 'The New Toronto (Tribute to Tory Lanez)', 'tribute');
rechaza('The New Toronto', 'The New Toronto - Tributo', 'tributo');
rechaza('Abbey Road', 'Abbey Road - Made Famous By The Beatles', 'made famous by');
rechaza('Abbey Road', 'Abbey Road (In the Style of The Beatles)', 'in the style of');
rechaza('Abbey Road', 'Abbey Road [Performed By The Studio Allstars]', 'performed by');
rechaza('Nevermind', 'Nevermind (Covers)', 'covers');
rechaza('Nevermind', 'Nevermind - Cover Version', 'cover version');
rechaza('Nevermind', 'Nevermind (Homenaje)', 'homenaje');
eq(MARCADORES_TRIBUTO.length, 8, 'el vocabulario de tributo tiene 8 entradas');

// ── 3. La dirección contraria: el pedido QUE SÍ trae el marcador ─────────────
//
// Si lo que se pidió es el disco en vivo, el disco en vivo es el correcto.

acepta('MTV Unplugged', 'MTV Unplugged', 'unplugged pedido, unplugged servido');
acepta('Unplugged in New York', 'Unplugged in New York', 'el marcador es parte del nombre real');
acepta("1989 (Taylor's Version)", '1989 (Taylors Version)', 'las dos escrituras del apóstrofo son el mismo marcador');
acepta('Live at Leeds', 'Live at Leeds', 'live pedido');
acepta('Covers', 'Covers', 'un disco que de verdad se llama Covers');
rechaza('1989', "1989 (Taylor's Version)", 'pedir 1989 no es pedir la regrabación');
rechaza('Live at Leeds', 'Live at Leeds (Karaoke)', 'el pedido trae live pero no karaoke');

// ── 4. La asimetría con track-match, escrita al lado ─────────────────────────
//
// Para PISTAS un pedido sin versión acepta cualquier versión (v=185, medido
// sobre 200 tarjetas reales). Para ÁLBUMES no. Si algún día alguien "unifica"
// las dos, este par de asserts se rompe junto.

eq(titleMatches('Tema Largo De Prueba', 'Tema Largo De Prueba - Sped Up'), true,
  'track-match: un pedido de PISTA sin versión acepta la versión');
eq(candidatoTraeVersionDeMas('Tema Largo De Prueba', 'Tema Largo De Prueba (Sped Up)'), true,
  'album-guard: un pedido de ÁLBUM sin versión la rechaza — al revés, a propósito');

// ── 5. `albumKey` NO se afloja ───────────────────────────────────────────────
//
// El repo avisa tres veces que aflojarla fusiona estos discos. El cambio de
// v=219 vive en el resolutor, no en la clave: acá se comprueba que siguen
// separados después de la tanda.

const distintos = (a, b, msg) => eq(albumKey(a, 'x') === albumKey(b, 'x'), false, msg);
distintos('American Football (LP2)', 'American Football (LP3)', 'American Football LP2 ≠ LP3');
distintos('Crystal Castles', 'Crystal Castles II', 'Crystal Castles I ≠ II');
distintos('÷', '=', 'Ed Sheeran ÷ ≠ =');
distintos('=', '+', 'Ed Sheeran = ≠ +');

// ── 6. Higiene del extractor ─────────────────────────────────────────────────

eq(marcadoresDeVersion('Abbey Road').size, 0, 'un nombre limpio no declara marcadores');
eq(marcadoresDeVersion('Abbey Road (Remastered)').size, 0, 'remaster es EDICIÓN, no versión');
eq([...marcadoresDeVersion("1989 (Taylor's Version)")][0], 'taylors version', 'el marcador se canoniza sin apóstrofo');
acepta('', '', 'dos vacíos no explotan');
acepta('Algo', null, 'un candidato nulo no explota');

console.log(`album-resolver: ${n} asserts OK`);
