// Split out of route.ts because Next.js's route-handler typing only allows a
// fixed set of exports (GET, POST, config values, ...) from a file literally
// named route.ts — an extra named export there fails `pnpm typecheck` against
// .next/types. A sibling file has no such restriction, so this one pure
// function lives here instead, importable both by the route and by
// scripts/test-signals.ts.

/** Pure resolver for the `template` query param: returns it ONLY when
 *  `force` is true, `undefined` otherwise — `undefined` is what tells
 *  `renderDigest` (src/lib/email/render.ts) to fall back to its
 *  DIGEST_TEMPLATE-env-var default, exactly as if no override had ever been
 *  supplied.
 *
 *  Gating on `force` is deliberate, not incidental: without it, `?template=v2`
 *  alone would let anyone redirect a REAL send (to the real subscriber list)
 *  to the unreviewed template. `force` already redirects delivery to
 *  DIGEST_TEST_EMAIL, so pairing the two is what makes "preview v2 safely"
 *  possible — see README's Rollout section. */
export function resolveTemplateOverride(force: boolean, templateParam: string | null): string | undefined {
  return force ? (templateParam ?? undefined) : undefined
}
