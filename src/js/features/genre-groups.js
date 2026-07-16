const GROUPS = {
  'Rock': [
    'rock', 'indie rock', 'alternative rock', 'classic rock', 'pop rock',
    'hard rock', 'punk rock', 'funk rock', 'blues rock', 'rap rock',
    'glam rock', 'garage rock', 'southern rock', 'progressive rock',
    'psychedelic rock', 'art rock', 'acoustic rock', 'folk rock',
    'math rock', 'piano rock', 'stoner rock', 'desert rock', 'surf rock',
    'gothic rock', 'space rock', 'reggae rock', 'rock argentino',
    'argentine rock', 'rock argento', 'rock nacional', 'rock en español',
    'rock en espanol', 'rock chileno', 'rock uruguayo', 'rock latino',
    'rock y alternativo', 'latin rock', 'asian rock', 'rock n roll',
    'rock and roll', 'rocanrol', 'acid rock', 'yacht rock', 'soft rock',
    'post-grunge', 'grunge', 'grungegaze', 'britpop', 'madchester',
    'neo-psychedelia', 'psychedelic', 'psychedelic pop', 'psychedelic folk',
  ],
  'Metal': [
    'metal', 'black metal', 'heavy metal', 'thrash metal', 'glam metal',
    'groove metal', 'alternative metal', 'nu metal', 'nu-metal',
    'hair metal', 'doom metal', 'sludge', 'sludge metal', 'mathcore',
    'grindcore', 'metalcore', 'post-hardcore', 'hardcore',
    'hardcore punk', 'old school hardcore', 'post-metal',
  ],
  'Hip-Hop / Rap': [
    'hip-hop', 'hip hop', 'hiphop', 'rap',
    'underground hip-hop', 'underground hip hop', 'underground rap',
    'uk hip hop', 'southern hip hop', 'southern rap', 'east coast hip hop',
    'east coast rap', 'east coast', 'west coast hip hop', 'west coast rap',
    'alternative hip hop', 'alternative rap', 'alternative hip-hop',
    'jazz rap', 'jazz hop', 'boom bap', 'old school hip hop',
    'dirty south', 'gangsta rap', 'gangster rap', 'pop rap', 'emo rap',
    'trap', 'cloud rap', 'plugg', 'dark plugg', 'pluggnb', 'drill',
    'uk drill', 'digicore', 'opium', 'sigilkore', 'phonk',
    'melodic rap', 'jerk', 'wave', 'crank wave', 'rage', 'rage rap',
    'latin trap', 'trap latino', 'trap argentino', 'argentine trap',
    'rap argentino', 'trap rap', 'country rap', 'jersey club',
    'experimental hip hop', 'experimental hip-hop', 'abstract hip hop',
    'abstract hip-hop', 'chill abstract hip hop', 'glitch hop',
    'indie hip hop', 'crunk', 'boom bap', 'french rap', 'french hip hop',
    'uk hip hop', 'uk r&b', 'indian underground rap', 'desi hip hop',
    'k-pop', 'kpop',
    'raop', 'instrumental hip-hop',
  ],
  'Pop': [
    'pop', 'indie pop', 'dream pop', 'bedroom pop', 'synthpop',
    'synth pop', 'art pop', 'soft pop', 'italian pop', 'dance-pop',
    'latin pop', 'teen pop', 'electropop', 'alt-pop', 'jangle pop',
    'hyperpop', 'jazz pop', 'folk pop', 'hypnagogic pop', 'noise pop',
    'sophisti-pop', 'cumbia pop', 'turkish pop', 'power pop',
    'chillwave', 'dreampop', 'chill',
  ],
  'R&B / Soul': [
    'rnb', 'r&b', 'r and b', 'rhythm and blues', 'alternative rnb',
    'alternative r&b', 'neo-soul', 'neo soul', 'soul', 'contemporary rnb',
    'prog-rnb', 'cloud rnb', 'chill rnb', 'dark r&b', 'uk r&b',
    'philly soul', 'northern soul', 'classic soul', 'quiet storm',
    'motown', 'new jack swing', 'gospel',
  ],
  'Electronic': [
    'electronic', 'electronica', 'house', 'deep house', 'tech house',
    'tropical house', 'progressive house', 'dutch house', 'electro house',
    'ambient house', 'stutter house', 'slap house', 'microhouse',
    'dance', 'edm', 'techno', 'dubstep', 'post-dubstep', 'trance',
    'progressive trance', 'psytrance', 'drum and bass', 'drum n bass',
    'dnb', 'breakbeat', 'idm', 'downtempo', 'ambient', 'drone',
    'vaporwave', 'synthwave', 'retrowave', 'uk garage', 'future garage',
    'garage', 'jungle', 'uk bass', 'bass', 'minimal synth', 'jazz fusion',
    'indietronica', '2-step', 'future bass', 'liquid funk', 'eurobeat',
    'electroclash', 'melbourne bounce', 'rave', 'chillout', 'electro',
    'trip-hop', 'trip hop', 'lo-fi', 'lofi', 'lo-fi indie', 'beats',
    'chiptune', '8-bit', '8bit', 'glitch', 'ambient', 'new age',
    'progressive', 'techno', 'tech house', 'lounge',
  ],
  'Folk / Acoustic': [
    'folk', 'indie folk', 'folk rock', 'folk pop', 'psychedelic folk',
    'singer-songwriter', 'acoustic', 'americana', 'alt-country',
    'country', 'bluegrass', 'roots', 'roots reggae',
  ],
  'Latin': [
    'latin', 'latin pop', 'latin rock', 'latin trap', 'latin alternative',
    'reggaeton', 'reggaeton chileno', 'cumbia', 'cumbia pop', 'salsa',
    'boleros', 'bolero', 'baladas', 'urbano latino', 'trap latino',
    'urbano', 'música tropical', 'rkt', 'indie latino', 'spanish',
    'bachata', 'trap argentino', 'argentine trap', 'rap argentino',
  ],
  'Jazz': [
    'jazz', 'jazz rap', 'jazz hop', 'jazz pop', 'jazz piano',
    'vocal jazz', 'avant-garde jazz', 'spiritual jazz', 'hard bop',
    'cool jazz', 'bebop', 'acid jazz', 'nu jazz', 'jazz fusion',
    'free jazz', 'swing', 'big band',
  ],
  'Blues': ['blues', 'blues rock', 'delta blues'],
  'Reggae / Dub': [
    'reggae', 'reggae rock', 'roots reggae', 'dub', 'dancehall',
    'skinhead reggae',
  ],
  'Punk / Emo': [
    'punk', 'punk rock', 'pop punk', 'hardcore punk', 'post-punk',
    'emo', 'midwest emo', 'post-hardcore',
  ],
  'Funk / Disco': [
    'funk', 'funk rock', 'disco', 'brazilian funk',
  ],
  'Classical': [
    'classical', 'opera', 'piano', 'composer', 'composers', 'soundtrack',
    'instrumental', 'saxophone',
  ],
  'Experimental': [
    'experimental', 'avant-garde', 'noise', 'post-rock', 'slowcore',
    'shoegaze', 'noise pop',
  ],
  'Oldies': ['oldies', '50s', '60s', '70s', 'doo wop'],
  'Nostalgia (80s-90s)': ['80s', '90s', 'new wave', 'new romantic', 'madchester'],
  'K-Pop': ['k-pop', 'kpop', 'korean'],
};

const TAG_TO_GROUP = new Map();
const CANONICAL_TAGS = new Set();
for (const [group, tags] of Object.entries(GROUPS)) {
  CANONICAL_TAGS.add(group);
  for (const tag of tags) {
    TAG_TO_GROUP.set(tag.toLowerCase(), group);
  }
}

function tagToGroup(tag) {
  return TAG_TO_GROUP.get(String(tag).toLowerCase()) || null;
}

function groupNames() {
  return Object.keys(GROUPS);
}

export { GROUPS, TAG_TO_GROUP, CANONICAL_TAGS, tagToGroup, groupNames };
