import Anthropic from '@anthropic-ai/sdk'
// zodOutputFormat's type signature requires the zod/v4 ZodType — the
// installed `zod` package (3.25.x) bundles that as a subpath export, so this
// is still the existing dependency, not a second one. Plain `import { z }
// from 'zod'` (the classic v3 export) fails to typecheck against it.
import { z } from 'zod/v4'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { buildPayload, isGrounded, SYSTEM_PROMPT } from './prompt'
import type { ScoredPick } from '@/lib/score'
import type { IndexCardData } from '@/market-data/indices'

const CommentarySchema = z.object({
  marketRead: z.string(),
  perStock: z.array(z.object({ symbol: z.string(), read: z.string() })),
})

export interface Commentary {
  marketRead: string
  perStock: Record<string, string>
}

/** One grounded Claude call per day.
 *
 *  Returns null on ANY failure — missing key, API error, schema mismatch, or a
 *  grounding violation. The digest omits the commentary blocks and still goes
 *  out; nothing here may fail the email.
 *
 *  effort is 'low' deliberately: this is interpretation over numbers we have
 *  already computed, not a reasoning problem, and the call has to fit inside
 *  the ingest route's preparation budget. Sampling parameters are not sent —
 *  Opus 5 rejects temperature, top_p and top_k with a 400. */
export async function generateCommentary(
  picks: ScoredPick[],
  indices: IndexCardData[],
): Promise<Commentary | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[ai] ANTHROPIC_API_KEY not set — skipping commentary')
    return null
  }
  if (picks.length === 0) return null

  try {
    const payload = buildPayload(picks, indices)
    const client = new Anthropic()
    const response = await client.messages.parse({
      model: 'claude-opus-5',
      // Thinking is on by default on Opus 5, and max_tokens caps thinking PLUS
      // the response text together — not the response alone. At effort:
      // 'low' thinking should be short, but nothing guarantees it leaves room
      // for a market read plus up to ten per-stock sentences; if it doesn't,
      // the response truncates mid-JSON, parse() throws, and the catch below
      // returns null — safe, but failing far more often than intended and for
      // a reason nobody would diagnose from the outside. 8000 is a ceiling,
      // not a target: we only pay for tokens actually generated, so raising
      // it costs nothing unless it's used. Do NOT disable thinking instead —
      // that carries its own documented failure modes on Opus 5 and buys
      // nothing here.
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'low',
        format: zodOutputFormat(CommentarySchema),
      },
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    })

    if (response.stop_reason === 'refusal') {
      console.error('[ai] commentary refused')
      return null
    }
    const parsed = response.parsed_output
    if (!parsed) return null

    // Grounding check across every string the model produced. One violation
    // drops the whole commentary rather than shipping a mix — a reader cannot
    // tell which sentences were checked.
    const all = [parsed.marketRead, ...parsed.perStock.map((p) => p.read)]
    for (const text of all) {
      if (!isGrounded(text, payload)) {
        console.error('[ai] commentary rejected: ungrounded figure')
        return null
      }
    }

    return {
      marketRead: parsed.marketRead,
      perStock: Object.fromEntries(parsed.perStock.map((p) => [p.symbol, p.read])),
    }
  } catch (e) {
    console.error(`[ai] commentary failed: ${(e as Error).message}`)
    return null
  }
}
