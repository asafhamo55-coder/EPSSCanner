// Chart PNGs live in a PUBLIC Supabase Storage bucket because mail clients
// fetch images unauthenticated — there is no way to pass a token from an
// email, and the content is a chart of public market data.

import { db } from '@/lib/db'

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'digest-charts'

/** Upload one chart and return its public URL, or null on any failure.
 *  Never throws: a chart that cannot be stored degrades the email, it does not
 *  fail the run that produced it. `upsert` is on because re-running
 *  preparation for the same day is a legitimate retry. */
export async function uploadChart(
  date: string,
  symbol: string,
  png: Buffer,
): Promise<string | null> {
  try {
    const path = `${date}/${symbol}.png`
    const supabase = db()
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, png, { contentType: 'image/png', upsert: true })
    if (error) {
      console.error(`[chart] upload failed for ${symbol}: ${error.message}`)
      return null
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    return data.publicUrl ?? null
  } catch (e) {
    console.error(`[chart] upload threw for ${symbol}: ${(e as Error).message}`)
    return null
  }
}

/** Delete chart folders older than `keepDays`. Returns how many objects were
 *  removed. Storage is finite and this runs daily, so without pruning the
 *  bucket grows without bound. Best-effort — a prune failure is logged. */
export async function pruneCharts(keepDays: number): Promise<number> {
  try {
    const supabase = db()
    const { data: folders, error } = await supabase.storage.from(BUCKET).list('')
    if (error || !folders) return 0
    const cutoff = new Date(Date.now() - keepDays * 86_400_000)
      .toISOString()
      .slice(0, 10)
    let removed = 0
    for (const folder of folders) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(folder.name) || folder.name >= cutoff) continue
      const { data: files } = await supabase.storage.from(BUCKET).list(folder.name)
      if (!files?.length) continue
      const paths = files.map((f) => `${folder.name}/${f.name}`)
      const { error: delErr } = await supabase.storage.from(BUCKET).remove(paths)
      if (!delErr) removed += paths.length
    }
    return removed
  } catch (e) {
    console.error(`[chart] prune failed: ${(e as Error).message}`)
    return 0
  }
}
