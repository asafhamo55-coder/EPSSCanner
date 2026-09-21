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
 *  Three passes, in two tiers of caution:
 *
 *  - hoistFontFamily hoists ONLY font-family and tabular-nums — sizes,
 *    weights and colours stay inline, so a client that strips `<style>`
 *    still renders every card correctly, just in its default typeface.
 *  - hoistRepeatedStyles hoists whatever ELSE repeats. This one trades that
 *    safety margin away: if `<style>` is stripped, elements it touched
 *    render unstyled (plain black text, no padding or colour) but keep
 *    their correct structure and every figure. Added because keeping full
 *    technical detail for every scoring pick — not just the top few — does
 *    not fit under the first pass alone; see its own doc comment for the
 *    reasoning.
 *  - collapseWhitespace is unconditionally safe; it never touches a style.
 *
 *  All three are mechanical and content-preserving — applied to finished
 *  HTML, so no template has to be restructured and no number can be lost in
 *  the edit. */

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

/** Hoists any REPEATED remaining style string into a generated class.
 *
 *  This is the broader step the font/tabular hoist deliberately stopped
 *  short of: sizes, weights and colours stay inline there specifically so a
 *  client that strips `<style>` still renders correctly. That safety
 *  argument no longer holds here — a card carrying the full technical panel
 *  for every scoring pick, not just the top few, does not fit Gmail's
 *  102,400-byte clipping limit without it. Making every pick fit was the
 *  explicit requirement this trades against.
 *
 *  Degradation if `<style>` is stripped: the affected elements render
 *  unstyled (default black text, no padding/colour) but keep their correct
 *  table structure and every figure — a plainer page, not a broken or
 *  misleading one. That is the accepted cost.
 *
 *  Only styles seen 2+ times are hoisted, and only when hoisting is
 *  cheaper than leaving them inline — `class="c3"` still costs bytes, so a
 *  style seen once, or a short one seen only a few times, can lose. The
 *  arithmetic is checked per candidate rather than assumed. */
function hoistRepeatedStyles(html: string): string {
  const styleAttr = /style="([^"]*)"/g
  const freq = new Map<string, number>()
  for (const m of html.matchAll(styleAttr)) {
    if (!m[1]) continue
    freq.set(m[1], (freq.get(m[1]) ?? 0) + 1)
  }

  const STYLE_ATTR_OVERHEAD = 'style=""'.length // 8
  const CLASS_ATTR_OVERHEAD = 'class=""'.length // 8
  const classFor = new Map<string, string>()
  let n = 0
  for (const [style, count] of freq) {
    if (count < 2) continue
    // 'h' prefix, not a bare base-36 digit: FONT_CLASS ('f') and NUM_CLASS
    // ('n') are both single lowercase letters, so an unprefixed counter
    // collides with one of them as soon as enough distinct styles are
    // hoisted (n=15 → 'f', n=23 → 'n') — silently merging an unrelated
    // style into the font-family or tabular-nums rule. Costs one byte per
    // reference; correctness over the extra byte.
    const name = `h${n.toString(36)}`
    n++
    const inlineBytes = (style.length + STYLE_ATTR_OVERHEAD) * count
    const hoistedBytes = (name.length + CLASS_ATTR_OVERHEAD) * count + `.${name}{${style}}`.length
    if (hoistedBytes < inlineBytes) classFor.set(style, name)
  }
  if (classFor.size === 0) return html

  const rewritten = html.replace(
    /<([a-zA-Z]+)([^>]*?)style="([^"]*)"/g,
    (whole, tag, attrs, style) => {
      const cls = classFor.get(style)
      if (!cls) return whole
      const existing = attrs.match(/\sclass="([^"]*)"/i)
      return existing
        ? `<${tag}${attrs.replace(existing[0], ` class="${existing[1]} ${cls}"`)}`
        : `<${tag}${attrs} class="${cls}"`
    },
  )
  const rules = [...classFor.entries()].map(([style, cls]) => `.${cls}{${style}}`).join('')
  // In production this always lands inside the <style> block FONT_STYLE_BLOCK
  // already put in <head> — compactHtml only ever runs on a full shell(). But
  // relying on that ordering silently, with no fallback, means a caller that
  // ever reorders it gets classes referencing rules that were never emitted:
  // not a content bug, but every hoisted element renders unstyled with no
  // signal anything went wrong. Prepending a fresh block if none exists makes
  // the function correct standalone, not just correct given today's caller.
  return rewritten.includes('</style>')
    ? rewritten.replace('</style>', `${rules}</style>`)
    : `<style>${rules}</style>${rewritten}`
}

export function compactHtml(html: string): string {
  return collapseWhitespace(hoistRepeatedStyles(hoistFontFamily(html)))
}
