/**
 * Catalogue plates.
 *
 * The museums hand us IIIF or static JPEG URLs; the app wants files under
 * `public/lots` so that a lot page renders without a round trip to Chicago
 * every time somebody scrolls the grid. This module is the bridge, and it is
 * written to be boring in exactly two ways.
 *
 * It never throws. A lot with no photograph is a worse outcome than a lot with
 * a generated plate, so every failure path returns an empty array and lets the
 * caller fall back to `writeLotArt`.
 *
 * It never re-downloads. The seed is run repeatedly during development, and
 * pulling eighty megabytes of public-domain JPEGs off a museum's CDN each time
 * is both slow and impolite when the bytes are already on disk.
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getBytes } from "./http";

export const LOTS_DIR = path.resolve(process.cwd(), "public/lots");

/** Hard cap on plates per lot. The lot page shows a hero and a filmstrip. */
export const MAX_PLATES = 3;

/**
 * A truncated response and an HTML error page both arrive as "bytes", and both
 * would be written out as a .jpg that no browser will draw. Checking the SOI
 * marker and a plausible size is cheap insurance against a silently broken
 * catalogue.
 */
function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 2_048 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Download up to `max` images for one lot and return their public paths.
 *
 * Returns `[]` on any failure — including a partial one — so the caller makes a
 * single all-or-nothing choice between real photography and generated art
 * rather than shipping a lot whose hero is a museum plate and whose second
 * view is an abstract pattern.
 */
export async function downloadLotImages(
  slug: string,
  urls: readonly string[],
  max = MAX_PLATES,
  dir = LOTS_DIR,
): Promise<string[]> {
  const wanted = urls.slice(0, Math.max(0, Math.min(max, MAX_PLATES)));
  if (wanted.length === 0) return [];

  try {
    mkdirSync(dir, { recursive: true });
    const paths: string[] = [];

    for (const [i, url] of wanted.entries()) {
      const file = `${slug}-${i + 1}.jpg`;
      const target = path.join(dir, file);

      // Already on disk from an earlier run: trust it and skip the request.
      if (existsSync(target) && statSync(target).size > 2_048) {
        paths.push(`/lots/${file}`);
        continue;
      }

      const bytes = await getBytes(url);
      if (!bytes || !looksLikeJpeg(bytes)) return [];
      writeFileSync(target, bytes);
      paths.push(`/lots/${file}`);
    }

    return paths;
  } catch {
    // Disk full, permissions, a malformed URL — none of it is worth failing a
    // seed over when there is a generated plate waiting behind it.
    return [];
  }
}

/**
 * Remove every plate the catalogue does not currently point at.
 *
 * Keyed on the exact public paths in use rather than on slugs, because two
 * things drift between runs and both leave litter: museum results shift, which
 * renames lots, and the number of generated plates per lot is a random draw,
 * which can leave a fourth `.svg` behind a lot that now has three. Matching
 * filenames catches both, where matching slugs catches only the first.
 *
 * Avatars are keyed by handle rather than by slug and are deliberately left
 * alone.
 */
export function pruneStalePlates(inUse: ReadonlySet<string>, dir = LOTS_DIR): number {
  const keep = new Set([...inUse].map((src) => path.basename(src)));
  let removed = 0;
  try {
    if (!existsSync(dir)) return 0;
    for (const file of readdirSync(dir)) {
      if (file.startsWith("avatar-")) continue;
      // House plates belong to the consignment wizard, not to any lot, so
      // they are never "stale" and must survive every reseed.
      if (file.startsWith("preview-")) continue;
      if (!/^.+-\d+\.(svg|jpg)$/.test(file)) continue;
      if (keep.has(file)) continue;
      unlinkSync(path.join(dir, file));
      removed++;
    }
  } catch {
    // Housekeeping is never worth aborting a seed for.
  }
  return removed;
}
