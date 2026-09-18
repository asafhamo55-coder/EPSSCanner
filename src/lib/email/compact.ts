import { FONT } from './primitives'

/** Post-processing that shrinks the rendered v2 email without removing a
 *  single figure from it.
 *
 *  Why this exists: v2 measured 114,976 bytes at five picks — Gmail clips at
 *  102,400 and shows "[Message clipped]". Measured against a real render,
 *  59% of the document was inline `style=` text and the 90-character font
 *  stack alone accounted for 27%, emitted 265 times across three picks. The
 *  content was never the problem; the markup carrying it was.
 *
 *  Both passes below are mechanical and content-preserving — they are applied
 *  to finished HTML, so no template has to be restructured and no number can
 *  be lost in the edit. */

/** Class used for the hoisted font stack. Deliberately one character: it is
 *  emitted on every styled element, so its own length is part of the saving. */
const FONT_CLASS = 'f'

/** Tabular figures. Hoisted on the same graceful-degradation argument as the
 *  font family, and it is the safest possible candidate: if a client strips
 *  <style>, digits simply stop being monospaced in the levels tables. No
 *  number changes, nothing reflows enough to matter. It appears 63 times in
 *  a three-pick render at 33 bytes each. */
const NUM_CLASS = 'n'
const TABULAR = 'font-variant-numeric:tabular-nums'

/** Emitted once in <head>. Only `font-family` is hoisted — never size, weight
 *  or colour.
 *
 *  That split is the whole safety argument. A minority of clients (notably
 *  the Gmail app signed in to a non-Gmail account) strip <style> entirely.
 *  With only the family hoisted, those readers fall back to their client's
 *  default typeface and lose nothing else: every size, weight, colour, width
 *  and table structure is still inline, so the email still reads as designed.
 *  Hoisting the `font` shorthand would have saved more and degraded far
 *  worse — 11px labels would render at the client's default body size. */
export const FONT_STYLE_BLOCK =
  `<style>.${FONT_CLASS}{font-family:${FONT}}.${NUM_CLASS}{${TABULAR}}</style>`

/** `font:<weight> <size> <stack>` → `font-weight:..;font-size:..` plus the
 *  class. Matches the shorthand this codebase actually emits (always weight
 *  then size then the shared stack); anything else is left alone rather than
 *  guessed at. */
function hoistFontFamily(html: string): string {
  const shorthand = new RegExp(
    `font:\\s*(\\d{3})\\s+(\\d+px)\\s+${FONT.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*;?`,
    'g',
  )
  return html.replace(/<([a-z]+)([^>]*?)style="([^"]*)"/gi, (whole, tag, attrs, style) => {
    const hasTabular = style.includes(TABULAR)
    if (!shorthand.test(style) && !hasTabular) return whole
    shorthand.lastIndex = 0
    let rewritten = style.replace(shorthand, (_m: string, weight: string, size: string) =>
      `font-weight:${weight};font-size:${size};`,
    )
    const classes = [shorthand.test(style) ? FONT_CLASS : null, hasTabular ? NUM_CLASS : null]
    shorthand.lastIndex = 0
    if (hasTabular) rewritten = rewritten.replace(`${TABULAR};`, '').replace(TABULAR, '')
    const added = classes.filter((c): c is string => c != null).join(' ')
    // Merge into an existing class attribute rather than emitting a second one.
    const existing = attrs.match(/\sclass="([^"]*)"/i)
    if (existing) {
      return `<${tag}${attrs.replace(existing[0], ` class="${existing[1]} ${added}"`)}style="${rewritten}"`
    }
    return `<${tag}${attrs} class="${added}" style="${rewritten}"`
  })
}

/** Tags whose surrounding whitespace is RENDERED. Between two block or
 *  table elements, the indentation in the template is invisible and free to
 *  delete. Between two inline elements it is a real space the reader sees —
 *  `<span>A</span>\n<span>B</span>` reads "A B", and blind collapsing turns
 *  it into "AB". The v2 card puts adjacent spans on separate source lines,
 *  so this distinction is load-bearing, not theoretical. */
const INLINE_TAGS = new Set([
  'span', 'a', 'b', 'strong', 'em', 'i', 'u', 'small', 'font', 'img', 'code', 'label',
])

/** Indentation between STRUCTURAL tags only. Runs inside a text node are
 *  squeezed to a single space — never removed — so copy never loses a word
 *  boundary. */
function collapseWhitespace(html: string): string {
  return html
    .replace(
      /(<\/?([a-zA-Z]+)[^>]*>)[\t\n\r ]+(?=<\/?([a-zA-Z]+))/g,
      (whole, openTag: string, left: string, right: string) =>
        INLINE_TAGS.has(left.toLowerCase()) || INLINE_TAGS.has(right.toLowerCase())
          ? whole
          : openTag,
    )
    .replace(/([\t\n\r ]{2,})(?=[^<]*?<)/g, ' ')
    .trim()
}

export function compactHtml(html: string): string {
  return collapseWhitespace(hoistFontFamily(html))
}
