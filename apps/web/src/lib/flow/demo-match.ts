/**
 * The same demo photos the API recognises in `rivet_api/concept/demo`.
 * Bytes win over the file name, because a re-saved picture keeps its pixels and loses its name.
 */
const DEMOS: readonly { key: string; names: readonly string[]; sha256: string }[] = [
  { key: 'drone', names: ['drone'], sha256: 'ce1c21c74961882612162462718b868c8b55a14787f537f850cc44710b432b3e' },
  { key: 'fpv_car', names: ['mini gizmofpv black', 'mini gizmofpv'], sha256: 'c781a9c9aa7cc4a9c188141951c0eb36aa947b4de615683372edb65da6c35a0c' },
  { key: 'rc_truck', names: ['rc car'], sha256: '0c6ea553b36da6bc829e5822ab7334e80fdbe719c84232398da5fa7f67aae026' },
  { key: 'boat', names: ['boat'], sha256: '0a398a6e2c86555a523bd90ae5d177abaa36e28ecc05863b5f741932d9de54e6' },
  { key: 'arm', names: ['mechanical arm'], sha256: '6e69b51dc408238152dbf8ae59ece3fad91f260ee90a78fb18c1cb831d07d3d9' },
  { key: 'robot_dog', names: ['robot dog'], sha256: 'caf4840ad1c0911f7f2b9d62d2926d20e5576331fe557e4a646d62a7290d8890' },
  { key: 'pi_camera', names: ['raspberry pi camera'], sha256: '4934d5940f12f2697cb38bd378ada580b5d581570306a3de0266c8d1663f81fc' },
  { key: 'esp32', names: ['microconstroller', 'microcontroller'], sha256: '5e87a8eb7f9d65a128c4bcc3765b4f8fa54abc54a0497af63fd671e74b21f917' },
];

function normaliseName(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? filename;
  const stem = base.replace(/\.[^.]+$/, '').toLowerCase().trim().replace(/(\s*\(\d+\)|\s+copy(\s+\d+)?)$/, '');
  return stem.replace(/[\s_\-.]+/g, ' ').trim();
}

async function sha256(file: File): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The hand-built demo this picture is, or null when it is not one of the reference photos. */
export async function matchDemoFile(file: File): Promise<string | null> {
  const digest = await sha256(file);
  if (digest) {
    const byBytes = DEMOS.find((d) => d.sha256 === digest);
    if (byBytes) return byBytes.key;
  }
  const name = normaliseName(file.name);
  return DEMOS.find((d) => d.names.includes(name))?.key ?? null;
}
