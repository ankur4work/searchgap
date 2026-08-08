/**
 * Normalize a shopper search query so that visually/lexically identical queries
 * collide to the same key.
 *
 * Steps:
 *   1. String-coerce + reject nullish.
 *   2. Unicode NFC to fold compatibility variants of the same character.
 *   3. Map whitespace control chars to a space; strip invisible ones.
 *   4. Lowercase (Turkish-safe via locale 'en-US').
 *   5. Strip punctuation EXCEPT hyphen `-` and apostrophe `'`
 *      (preserve: "t-shirt", "men's").
 *   6. Collapse whitespace (including unicode whitespace) to single space.
 *   7. Trim.
 *
 * The output never throws; for empty/non-string input it returns "".
 */

/**
 * Tab, LF, VT, FF, CR. These are word SEPARATORS, so they must become a space.
 * Deleting them (as a single blanket control-char strip does) splices the
 * surrounding words together — "red\tcotton" collapses to "redcotton" and the
 * query is recorded as a term the shopper never typed, which then fails to
 * match any product and is misfiled as a "missing product" gap.
 */
function isWhitespaceControl(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c || code === 0x0d;
}

/**
 * Control, zero-width, bidi-override and BOM characters. Unlike the above these
 * mark no word boundary, so removing them outright is what we want:
 * "te<ZWSP>st" must normalize to "test" so it collides with a plain "test".
 */
function isInvisible(code: number): boolean {
  return (
    code <= 0x1f ||
    code === 0x7f ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}

/**
 * Expressed as a code-point scan rather than a character-class regex so the
 * source file carries no literal control bytes and no long escape soup.
 */
function stripInvisibles(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (isWhitespaceControl(code)) {
      out += ' ';
    } else if (!isInvisible(code)) {
      out += ch;
    }
  }
  return out;
}

export function normalizeQuery(input: unknown): string {
  if (typeof input !== 'string') return '';
  let s = input.normalize('NFC');
  s = stripInvisibles(s);
  s = s.toLocaleLowerCase('en-US');
  s = s.replace(/[\p{P}\p{S}]/gu, (ch) => (ch === '-' || ch === "'" ? ch : ' '));
  s = s.replace(/\s+/gu, ' ');
  return s.trim();
}

/**
 * Date bucket (UTC, day-truncated) used as the dedup axis for search_queries
 * upsert. Store-local bucketing is handled later in the analytics layer.
 */
export function dateBucketUTC(d: Date): Date {
  const bucket = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
  return bucket;
}

/**
 * Is `next` the completion of a word the shopper was still typing in `prev`,
 * rather than a new, deliberate search that happens to start with it?
 *
 * The distinction is the character that follows the prefix:
 *   "test pr"  → "test products"   char is 'o'  — same word continuing → artifact
 *   "shoes"    → "shoes red"       char is ' '  — a new word added     → deliberate
 *
 * Getting this wrong in the permissive direction destroys real shopper data,
 * so anything that is not unambiguously mid-word is kept.
 */
export function isTypingArtifact(prev: string, next: string): boolean {
  if (!prev || prev === next) return false;
  if (!next.startsWith(prev)) return false;
  // A completed word followed by more input is a refinement, not a keystroke.
  if (prev.endsWith(' ')) return false;
  return next.charAt(prev.length) !== ' ';
}
