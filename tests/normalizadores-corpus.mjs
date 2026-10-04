// tests/normalizadores-corpus.mjs — el corpus de la foto de normalizadores.
//
// Dos partes, y la distinción importa:
//
//   CASOS — los 120 a mano del informe de reconocimiento del 2026-10-03. Cada
//   uno está ahí porque el informe DEMOSTRÓ que algún normalizador lo trata
//   distinto de los demás: «Daft Punk» que queda en «da» por el corte de feat
//   sin `\b`, «÷» y «=» de Ed Sheeran que colapsan a la misma clave en
//   `listened-shared`, «¥$» que queda vacío… Sus salidas van ENTERAS al
//   fixture, una por una, para que el diff de un cambio se lea.
//
//   CORPUS — los nombres reales de `src/data/history-*.json`: ~6.9k artistas,
//   16k álbumes y 16k pistas. Es el que encuentra lo que nadie pensó. Sus
//   salidas van al fixture como un HASH por función (ver el test).
//
// ⚠️ `listening-history.json` es irreemplazable y acá solo se LEE.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
const leer = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

// ── Los 120 casos a mano ─────────────────────────────────────────────────────
// Pares [nombre, artista]. Cuando el caso es sobre un nombre suelto, el artista
// va igual porque las funciones de clave lo piden.
export const CASOS = [
  // 2a — el corte de feat/ft/with sin \b (el que rompe «Daft Punk»)
  ['Get Lucky', 'Daft Punk'],
  ['Harder, Better, Faster, Stronger', 'Daft Punk'],
  ['Something About Us', 'Daft Punk'],
  ['Nightcall', 'Craft Spells'],
  ['Tainted Love', 'Soft Cell'],
  ['Say Nothing', 'Shift K3Y'],
  ['Hello Hello', 'Sopwith Camel'],
  ['Tema', 'Thrift System'],
  ['Tema', 'Soft Q'],
  ['Lift Off', 'Jay-Z'],
  ['Drift Away', 'Dobie Gray'],
  ['Left With Nothing', 'Tema'],
  ['Dancing With Myself', 'Billy Idol'],
  ['Swift Reaction', 'Tema'],
  ['no tears left to cry', 'Ariana Grande'],
  ['Soft Animals EP', 'Tema'],
  ['Taylor Swift Karaoke: reputation', 'Taylor Swift'],
  ['Kernkraft 400 (A Better Day)', 'Topic'],
  ['Gift Shop', 'The Tragically Hip'],
  ['Left Hand Free', 'alt-J'],
  ['With You', 'Chris Brown'],
  ['With Somebody Else', 'The Vamps'],
  ['Stay With Me', 'Sam Smith'],
  ['With Or Without You', 'U2'],
  ['Dancing With A Stranger', 'Sam Smith'],
  ['Shallow (feat. Bradley Cooper)', 'Lady Gaga'],
  ['Only You (feat. The Notorious B.I.G.) - Bad Boy Remix', '112'],
  ['Tema ft. Alguien', 'Artista'],
  ['Tema featuring Alguien', 'Artista'],
  ['Tema ft Alguien', 'Artista'],
  ['Tema (with Lauv)', 'Artista'],
  ['A Different Way - DEVAULT Remix', 'DJ Snake'],
  ['A Different Way (with Lauv)', 'DJ Snake'],

  // 2b — los nombres que quedan vacíos
  ['CARNIVAL', '¥$'],
  ['VULTURES 1', '¥$'],
  ['VULTURES 1', 'Kanye West'],
  ['Tema', '[bsd.u]'],
  ['Tema', '[Kyle Davis]'],
  ['Tema', 'ギヴン'],
  ['Tema', '阿达娃'],
  ['Tema', 'Небесный душ'],
  ['Tema', '緑'],
  ['Tema', '-'],
  ['Tema', '.- .-.. --. --- / . -. / -- --- .-. ... .'],
  ['÷', 'Ed Sheeran'],
  ['=', 'Ed Sheeran'],
  ['+', 'Ed Sheeran'],
  ['x', 'Ed Sheeran'],
  ['No.6 Collaborations Project', 'Ed Sheeran'],

  // 2c — claves de álbum: qué junta y qué separa cada criterio
  ['Igor', 'Tyler, The Creator'],
  ['IGOR', 'Tyler, The Creator'],
  ['Igor (Deluxe)', 'Tyler, The Creator'],
  ['Igor Deluxe', 'Tyler, The Creator'],
  ['Love', 'The Cult'],
  ['Love (Expanded Edition)', 'The Cult'],
  ['Abbey Road (Remastered)', 'The Beatles'],
  ['Abbey Road - 2019 Remaster', 'The Beatles'],
  ["Harry's House", 'Harry Styles'],
  ["Harry's House (Piano Version)", 'Harry Styles'],
  ['1989', 'Taylor Swift'],
  ["1989 (Taylor's Version)", 'Taylor Swift'],
  ['Red', 'Taylor Swift'],
  ["Red (Taylor's Version)", 'Taylor Swift'],
  ['Random Access Memories', 'Daft Punk'],
  ['Random Access Memories (10th Anniversary Edition)', 'Daft Punk'],
  ['RAM', 'Daft Punk'],
  ['RAM (10th Anniversary Edition)', 'Daft Punk'],
  ['eternal sunshine', 'Ariana Grande'],
  ['eternal sunshine (slightly deluxe and also live)', 'Ariana Grande'],
  ['American Football LP2', 'American Football'],
  ['American Football LP3', 'American Football'],
  ['Crystal Castles', 'Crystal Castles'],
  ['Crystal Castles II', 'Crystal Castles'],
  ['Blonde', 'Frank Ocean'],
  ['Blond', 'Frank Ocean'],
  ['Bridge Over Troubled Water', 'Simon & Garfunkel'],
  ['Bridge Over Troubled Water', 'Simon and Garfunkel'],
  ['Stoney', 'Post Malone'],
  ['Stoney - Deluxe', 'Post Malone'],
  ['Como tú', 'Artista'],
  ['Como tu', 'Artista'],
  ['Teléfono', 'Aitana'],
  ['Telefono', 'Aitana'],
  ['Vol. 2', 'Artista'],
  ['Part 1', 'Artista'],
  ['Tema (Deluxe Version)', 'Artista'],
  ['Tema (Intimate)', 'Artista'],
  ['Tema (Acoustic)', 'Artista'],
  ['Tema (Instrumental)', 'Artista'],
  ['Tema (Unplugged)', 'Artista'],
  ['Tema (Collector’s Edition)', 'Artista'],
  ['Tema (Platinum Edition)', 'Artista'],
  ['Tema (Mono)', 'Artista'],
  ['Tema (Stereo)', 'Artista'],
  ['Tema (Bonus Track Version)', 'Artista'],
  ['Tema (Anniversary Reissue)', 'Artista'],
  ['Tema - Remastered 2011', 'Artista'],
  ['Tema (2019 Remaster)', 'Artista'],
  ['Tema (Legacy Edition)', 'Artista'],
  ['The Tema Edition', 'Artista'],
  ['Tema (1989)', 'Artista'],
  ['Tema - 1989', 'Artista'],

  // 2d — pistas: versiones, remixes, live
  ['Timeless', 'The Weeknd'],
  ['Timeless - DEVAULT Remix', 'The Weeknd'],
  ['Timeless Sped Up', 'The Weeknd'],
  ['Tema (Live)', 'Artista'],
  ['Love Story', 'Taylor Swift'],
  ["Love Story (Taylor's Version)", 'Taylor Swift'],
  ['Burning Piles (Slowed)', 'Mount Eerie'],
  ['Burning Piles', 'Mount Eerie'],
  ['Tema - Radio Edit', 'Artista'],
  ['Tema - Single Version', 'Artista'],
  ['Tema - Album Version', 'Artista'],
  ['Tema - Original Mix', 'Artista'],
  ['Tema - Extended', 'Artista'],
  ['Tema - From "Pelicula"', 'Artista'],
  ['Tema (Re-Record)', 'Artista'],
  ['Tema (Rerecord)', 'Artista'],

  // 2e — track-match: artistas que se parecen y los que no
  ['Tema', 'Drake'],
  ['Tema', 'Nick Drake'],
  ["Tema", "Her's"],
  ['Tema', 'Samuel T. Herring'],
  ['Tema', 'Kanye West & Ty Dolla $ign'],
  ['Tema', 'A, B, C'],

  // nombres de playlist (#18 y #19) y los bordes del trim/colapso
  ['fonoteca · ocultos (sin clasificar)', 'x'],
  ['Fonoteca · Ocultos (skips)', 'x'],
  ['  fonoteca · ocultos (descubrir)  ', 'x'],
  ['fonoteca ·  ocultos (álbumes)', 'x'],
  ['FONOTECA · OCULTOS', 'x'],
  ['fonoteca ocultos', 'x'],
  ['  Tema   con   espacios  ', '  Artista  '],
  ['', ''],
  [' ', ' '],

  // delimitadores desbalanceados: separan likeNameKey de los otros tres regex
  ['Tema (Live]', 'Artista'],
  ['Tema [Live)', 'Artista'],
  ['(Live] Tema', 'Artista'],
];

// ── El corpus real ───────────────────────────────────────────────────────────
//
// `history-track-plays.json` → `albums`: filas `[nombre, artista, …]`.
// `history-artist-tracks.json` → `artists`: OBJETO `{nombre: [[pista, …], …]}`
// (no un array: el informe no lo dice y cuesta un TypeError averiguarlo).
export function cargarCorpus() {
  const albums = leer('history-track-plays.json').albums
    .map(a => [String(a[0] ?? ''), String(a[1] ?? '')]);

  const artistas = [];
  const pistas = [];
  for (const [nombre, tracks] of Object.entries(leer('history-artist-tracks.json').artists)) {
    artistas.push([String(nombre ?? ''), String(nombre ?? '')]);
    for (const t of (tracks || [])) pistas.push([String(t[0] ?? ''), String(nombre ?? '')]);
  }

  return { albums, artistas, pistas };
}
