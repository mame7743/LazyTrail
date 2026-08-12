/**
 * Deterministic display-name -> branch-slug conversion.
 *
 * Full machine translation (ja -> en) requires a network/API dependency this
 * extension does not take on. Instead we romanize kana deterministically
 * (Hepburn-ish), pass through ASCII as-is, and fall back to a short
 * timestamp-based token for anything we cannot transliterate (kanji, emoji,
 * etc). The result is always a valid, deterministic git branch segment that
 * the user can freely edit before confirming (candidates are suggestions,
 * not final).
 */

const KANA_MAP: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  っ: '',
  ー: '',
};

function katakanaToHiragana(input: string): string {
  return input.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function romanizeKana(input: string): string {
  const hira = katakanaToHiragana(input);
  let out = '';
  let i = 0;
  while (i < hira.length) {
    const two = hira.slice(i, i + 2);
    const one = hira[i];
    if (hira[i] === 'っ' && i + 1 < hira.length) {
      const next = KANA_MAP[hira[i + 1]] ?? KANA_MAP[hira.slice(i + 1, i + 3)];
      if (next) {
        out += next[0]; // sokuon doubles the following consonant
        i++;
        continue;
      }
    }
    if (KANA_MAP[two] !== undefined) {
      out += KANA_MAP[two];
      i += 2;
      continue;
    }
    if (KANA_MAP[one] !== undefined) {
      out += KANA_MAP[one];
      i++;
      continue;
    }
    out += one;
    i++;
  }
  return out;
}

/** Short deterministic fallback token for characters we cannot transliterate (e.g. kanji). */
function fallbackToken(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
}

/**
 * Produce a deterministic branch-safe slug candidate from a (possibly
 * Japanese) display name. Always returns a non-empty, git-ref-safe string.
 */
export function slugify(displayName: string): string {
  const romanized = romanizeKana(displayName);
  const ascii = romanized
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  // If romanization removed everything meaningful (pure kanji/symbols), the
  // ascii-filter above leaves nothing usable behind — fall back to a
  // deterministic hash token so the slug is still stable across calls.
  const meaningful = ascii.replace(/[^a-z0-9]/g, '');
  const base = meaningful.length > 0 ? ascii : `work-${fallbackToken(displayName)}`;

  return base.slice(0, 48).replace(/^-+|-+$/g, '') || `work-${fallbackToken(displayName)}`;
}

/**
 * Ensure uniqueness against a set of already-used slugs by appending -2, -3, ...
 * Deterministic given the same inputs and existing-slug set.
 */
export function dedupeSlug(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
