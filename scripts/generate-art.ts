/**
 * Procedural lot artwork.
 *
 * Auctioneer ships no binary image assets: every lot photograph, every avatar
 * is an SVG synthesised here from a string seed. That keeps the repo tiny and
 * the demo reproducible on any machine, but it means the output has to earn
 * its place on a gallery wall — a grey box with a filename in it would read as
 * "unfinished", not "abstract".
 *
 * The look is borrowed from what an auction house already prints: guilloché
 * rosettes (the engine-turned line work on banknotes, share certificates and
 * watch dials), deep lacquered grounds, and metallic leaf. It photographs as
 * expensive because the reference material is.
 *
 * Determinism is a hard requirement — `Math.random` is never used. The same
 * seed must produce byte-identical SVG on every run, so re-seeding the
 * database does not churn the whole `public/lots` directory in git.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                    */
/* -------------------------------------------------------------------------- */

/** FNV-1a — string -> 32-bit seed. Cheap, and well spread for short keys. */
function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: 32 bits of state, good enough for graphics, four lines long. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  (): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** True with probability `p`. */
  chance(p: number): boolean;
}

function rng(seed: string): Rng {
  const next = mulberry32(hashSeed(seed)) as Rng;
  next.range = (min, max) => min + next() * (max - min);
  next.int = (min, max) => Math.floor(min + next() * (max - min + 1));
  next.pick = (items) => items[Math.floor(next() * items.length)];
  next.chance = (p) => next() < p;
  return next;
}

/**
 * Coordinates are rounded to one decimal before they reach the file. At
 * 1200px that is sub-pixel precision nobody can see, and it roughly halves the
 * byte cost of the guilloché paths, which are thousands of points long.
 */
function f(value: number): string {
  const r = Math.round(value * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/* -------------------------------------------------------------------------- */
/* Palettes                                                                    */
/* -------------------------------------------------------------------------- */

interface Scheme {
  name: string;
  /** Three ground stops, darkest-to-lightest (or reversed for light schemes). */
  ground: readonly [string, string, string];
  /** The off-centre bloom that keeps the ground from reading as flat paint. */
  glow: string;
  accentA: string;
  accentB: string;
  /** Engraving colour: the guilloché and hairline work. */
  line: string;
  /** Vignette ink — black for dark schemes, warm umber for light ones. */
  vignette: string;
  light: boolean;
}

/**
 * Named after the finishes they imitate. Only one is light (`ivory-ink`); a
 * catalogue that is uniformly dark looks like a bug rather than a house style,
 * and the single pale sheet gives a grid of thumbnails somewhere to breathe.
 */
const SCHEMES: readonly Scheme[] = [
  {
    name: "obsidian-gold",
    ground: ["#04060a", "#0b1119", "#161f2b"],
    glow: "#2b3a4f",
    accentA: "#c8a24a",
    accentB: "#f0dfae",
    line: "#d9bb6a",
    vignette: "#000000",
    light: false,
  },
  {
    name: "oxblood-brass",
    ground: ["#170608", "#2c0c11", "#45151b"],
    glow: "#6a2a24",
    accentA: "#b08d57",
    accentB: "#e6c48c",
    line: "#cfa367",
    vignette: "#100304",
    light: false,
  },
  {
    name: "deep-teal-champagne",
    ground: ["#03151a", "#07272e", "#0d3a43"],
    glow: "#0f5560",
    accentA: "#7fd0c8",
    accentB: "#f2e6c6",
    line: "#e4d3a6",
    vignette: "#01090c",
    light: false,
  },
  {
    name: "ivory-ink",
    ground: ["#f6f1e7", "#ece4d5", "#ddd2bd"],
    glow: "#ffffff",
    accentA: "#1d1b17",
    accentB: "#8d7a56",
    line: "#5d5344",
    vignette: "#6b5c42",
    light: true,
  },
  {
    name: "aubergine-rose-gold",
    ground: ["#120510", "#280c26", "#3d1338"],
    glow: "#5c2450",
    accentA: "#e6a68d",
    accentB: "#f4cdb6",
    line: "#e0a189",
    vignette: "#0a0209",
    light: false,
  },
  {
    name: "midnight-sapphire",
    ground: ["#02060f", "#081227", "#0f2044"],
    glow: "#1b3a78",
    accentA: "#9db6ff",
    accentB: "#dbe6ff",
    line: "#a8bde8",
    vignette: "#000308",
    light: false,
  },
  {
    name: "graphite-verdigris",
    ground: ["#080a09", "#121815", "#1d2823"],
    glow: "#25453a",
    accentA: "#6fae95",
    accentB: "#d8e7de",
    line: "#8cc4ac",
    vignette: "#000201",
    light: false,
  },
  {
    name: "porphyry-silver",
    ground: ["#0d0709", "#221319", "#3a2029"],
    glow: "#5a2f3c",
    accentA: "#c9c6cf",
    accentB: "#efedf2",
    line: "#b9b3c0",
    vignette: "#060205",
    light: false,
  },
];

/* -------------------------------------------------------------------------- */
/* Guilloché                                                                   */
/* -------------------------------------------------------------------------- */

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * A hypotrochoid — the curve a pen traces from inside a rolling circle, which
 * is literally how a rose engine cuts a watch dial.
 *
 * Emitted centred on the origin so callers can place, rotate and scale copies
 * with `<use>`: one path definition can carry five visible rosettes for a few
 * dozen extra bytes, which is what keeps these files under the size budget.
 *
 * `R` and `r` are integers so the curve closes exactly after `r/gcd(R,r)`
 * turns; a non-closing rosette shows a seam and looks like a rendering fault.
 */
function hypotrochoidPath(R: number, r: number, d: number, radius: number, steps: number): string {
  const turns = r / gcd(R, r);
  const total = Math.PI * 2 * turns;
  // Normalise so the widest excursion always fills `radius`, whatever R/r/d are.
  const extent = R - r + d;
  const k = radius / extent;
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * total;
    const x = ((R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t)) * k;
    const y = ((R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)) * k;
    parts.push(`${f(x)} ${f(y)}`);
  }
  // Implicit lineto repetition: "M x y L x y x y x y ..." — one command, not N.
  return `M ${parts[0]} L ${parts.slice(1).join(" ")} Z`;
}

/* -------------------------------------------------------------------------- */
/* Lot artwork                                                                 */
/* -------------------------------------------------------------------------- */

const SIZE = 1200;

/**
 * A complete standalone SVG for one lot image.
 *
 * The scheme is chosen from `seed` alone while every other decision folds in
 * `variant`, so a lot's two-to-four images read as one object photographed
 * from different angles rather than four unrelated pictures.
 */
/**
 * Grain is rasterised once into a small tile and repeated, never computed
 * across the full canvas.
 *
 * A catalogue grid puts two dozen of these on screen at once. `feTurbulence`
 * is per-pixel Perlin noise, so a full-canvas grain costs SIZE² evaluations
 * per image and forces the browser to allocate a SIZE²x4 intermediate surface
 * for each one. At grid scale that reliably killed the renderer — the page
 * loaded and then died. Tiling drops the noise to GRAIN_TILE² pixels, and the
 * blur regions below are bounded for the same reason.
 */
const GRAIN_TILE = 220;

export function generateLotArt(seed: string, variant: number): string {
  const scheme = SCHEMES[hashSeed(seed) % SCHEMES.length];
  const r = rng(`${seed}::${variant}`);
  const uid = (hashSeed(`${seed}#${variant}`) % 46656).toString(36);
  const id = (name: string) => `${name}${uid}`;

  const cx = SIZE / 2;
  const cy = SIZE / 2;

  /* -- Ground -------------------------------------------------------------- */
  const groundAngle = r.range(0, 360);
  const glowX = r.range(0.25, 0.75);
  const glowY = r.range(0.2, 0.6);

  /* -- Guilloché rosettes -------------------------------------------------- */
  // Petal count is R/gcd(R,r): high enough for a lace, low enough that the
  // curve does not collapse into a filled ring at this stroke weight.
  const bigR = r.int(11, 23);
  let bigr = r.int(3, 9);
  if (bigR % bigr === 0) bigr += 1; // a clean divisor degenerates into a circle
  const fineR = r.int(9, 19);
  const finer = r.int(2, 7);

  const rosette = hypotrochoidPath(bigR, bigr, r.range(0.6, 2.2), 520, 560);
  const filigree = hypotrochoidPath(fineR, finer, r.range(0.4, 1.6), 520, 480);

  /* -- Composition --------------------------------------------------------- */
  const layers: string[] = [];

  // Wide washes of colour, heavily blurred, placed off-centre. These do most
  // of the work: they are what stops the ground reading as flat paint.
  const haze: string[] = [];
  for (let i = 0; i < 3; i++) {
    const hx = r.range(120, 1080);
    const hy = r.range(120, 1080);
    const rx = r.range(280, 620);
    const ry = rx * r.range(0.5, 1.15);
    const fill = r.chance(0.5) ? scheme.accentA : scheme.glow;
    haze.push(
      `<ellipse cx="${f(hx)}" cy="${f(hy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}" opacity="${f(r.range(0.1, 0.26))}" transform="rotate(${f(r.range(0, 180))} ${f(hx)} ${f(hy)})"/>`,
    );
  }
  layers.push(`<g filter="url(#${id("haze")})">${haze.join("")}</g>`);

  // Mid-ground solids: rotated plates and lozenges. Kept few and large — the
  // luxury reference is a Rothko, not a mosaic. Only lightly blurred, because
  // a composition with no hard edge anywhere reads as an out-of-focus photo.
  const solids: string[] = [];
  const solidCount = r.int(2, 4);
  for (let i = 0; i < solidCount; i++) {
    const w = r.range(240, 760);
    const h = r.range(240, 900);
    const x = r.range(-80, SIZE - w + 80);
    const y = r.range(-80, SIZE - h + 80);
    solids.push(
      `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(r.range(0, 60))}" fill="${r.chance(0.45) ? `url(#${id("sweep")})` : scheme.accentA}" opacity="${f(r.range(0.08, 0.2))}" transform="rotate(${f(r.range(-38, 38))} ${f(x + w / 2)} ${f(y + h / 2)})"/>`,
    );
  }
  layers.push(`<g filter="url(#${id("soft")})">${solids.join("")}</g>`);

  // Bezier ribbons sweeping the full width, bowed toward the centre so they
  // wrap the rosette instead of cutting across it.
  const ribbons: string[] = [];
  const ribbonCount = r.int(2, 4);
  for (let i = 0; i < ribbonCount; i++) {
    const y0 = r.range(-100, 1300);
    const y1 = r.range(-100, 1300);
    const bow = r.range(-520, 520);
    ribbons.push(
      `<path d="M -140 ${f(y0)} C ${f(cx * 0.5)} ${f(y0 + bow)} ${f(cx * 1.5)} ${f(y1 - bow)} 1340 ${f(y1)}" fill="none" stroke="url(#${id("ribbon")})" stroke-width="${f(r.range(26, 96))}" stroke-linecap="round" opacity="${f(r.range(0.18, 0.42))}"/>`,
    );
  }
  layers.push(`<g filter="url(#${id("soft")})">${ribbons.join("")}</g>`);

  // Barleycorn band: forty-odd hairlines a few pixels apart. Individually
  // invisible, collectively the shimmer you see on an engine-turned dial.
  const bandInner = r.range(210, 430);
  const bandGap = r.range(3.2, 7);
  const bandLines = r.int(26, 52);
  const band: string[] = [];
  for (let i = 0; i < bandLines; i++) {
    band.push(
      `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(bandInner + i * bandGap)}" fill="none" stroke="${scheme.line}" stroke-width="0.5"/>`,
    );
  }
  layers.push(
    `<g opacity="${f(r.range(0.14, 0.3))}" transform="rotate(${f(r.range(0, 90))} ${f(cx)} ${f(cy)}) translate(${f(cx)} ${f(cy)}) scale(1 ${f(r.range(0.62, 1))}) translate(${f(-cx)} ${f(-cy)})">${band.join("")}</g>`,
  );

  // Dashed hairline arcs — the "index track" of a dial. `stroke-dasharray` on
  // a circle is the cheapest way to draw an arc, and a per-ring rotation
  // staggers the gaps so they never line up into a visible seam.
  const arcs: string[] = [];
  const ringCount = r.int(4, 8);
  for (let i = 0; i < ringCount; i++) {
    const rad = 150 + i * r.range(48, 78);
    const circumference = 2 * Math.PI * rad;
    arcs.push(
      `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}" fill="none" stroke="${scheme.line}" stroke-width="${f(r.range(0.8, 2.4))}" stroke-dasharray="${f(circumference * r.range(0.12, 0.55))} ${f(circumference)}" opacity="${f(r.range(0.22, 0.5))}" transform="rotate(${f(r.range(0, 360))} ${f(cx)} ${f(cy)})"/>`,
    );
  }
  layers.push(`<g>${arcs.join("")}</g>`);

  // The engraving proper. One rosette is a scribble; the same rosette stamped
  // N times at 360/N apart is a rose engine — the overlaps build the moiré
  // that makes banknote work look machined rather than drawn. `<use>` keeps
  // all N copies at the cost of one path definition, and
  // `vector-effect="non-scaling-stroke"` holds every copy to a true hairline
  // however far it is scaled.
  const stackCount = r.int(9, 20);
  // A scale over ~1.2 pushes the rosette off the plate, which reads as a
  // cropped detail shot rather than a centred medallion — worth having in the
  // mix so a grid of thumbnails is not twelve concentric bullseyes.
  const stackScale = r.chance(0.3) ? r.range(1.2, 1.7) : r.range(0.62, 1.06);
  const stackRot = r.range(0, 360);
  const stackX = cx + r.range(-170, 170);
  const stackY = cy + r.range(-170, 170);
  const stack: string[] = [];
  for (let i = 0; i < stackCount; i++) {
    stack.push(
      `<use href="#${id("rose")}" transform="translate(${f(stackX)} ${f(stackY)}) rotate(${f(stackRot + (360 / stackCount) * i)}) scale(${f(stackScale)})"/>`,
    );
  }
  layers.push(
    `<g fill="none" stroke="${scheme.line}" stroke-width="${f(r.range(0.5, 0.9))}" opacity="${f(r.range(0.16, 0.3))}">${stack.join("")}</g>`,
  );

  // A smaller, brighter satellite rosette offset from centre, so the symmetry
  // is broken by something intentional rather than by noise.
  const satN = r.int(3, 7);
  const satX = r.range(240, 960);
  const satY = r.range(240, 960);
  const satScale = r.range(0.16, 0.44);
  const satellite: string[] = [];
  for (let i = 0; i < satN; i++) {
    satellite.push(
      `<use href="#${id("fil")}" transform="translate(${f(satX)} ${f(satY)}) rotate(${f((360 / satN) * i)}) scale(${f(satScale)})"/>`,
    );
  }
  layers.push(
    `<g fill="none" stroke="${scheme.accentB}" stroke-width="0.7" opacity="${f(r.range(0.24, 0.46))}">${satellite.join("")}</g>`,
  );

  // A bright disc: a focal point so the eye lands somewhere. Without it the
  // composition is pleasant but aimless.
  const focalR = r.range(90, 210);
  const focalX = r.range(320, 880);
  const focalY = r.range(320, 880);
  layers.push(
    `<circle cx="${f(focalX)}" cy="${f(focalY)}" r="${f(focalR)}" fill="url(#${id("focal")})" opacity="${f(r.range(0.35, 0.72))}"/>`,
    `<circle cx="${f(focalX)}" cy="${f(focalY)}" r="${f(focalR + r.range(14, 46))}" fill="none" stroke="${scheme.accentB}" stroke-width="1.1" opacity="0.45"/>`,
  );

  // One crisp unblurred outline — a lozenge or a hoop — carrying a hard edge
  // that the eye can use to focus the whole plate.
  const keyRot = r.range(0, 90);
  const keySize = r.range(340, 760);
  layers.push(
    r.chance(0.5)
      ? `<rect x="${f(cx - keySize / 2)}" y="${f(cy - keySize / 2)}" width="${f(keySize)}" height="${f(keySize)}" fill="none" stroke="${scheme.accentB}" stroke-width="1.4" opacity="0.3" transform="rotate(${f(keyRot)} ${f(cx)} ${f(cy)})"/>`
      : `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(keySize / 2)}" ry="${f((keySize / 2) * r.range(0.5, 0.9))}" fill="none" stroke="${scheme.accentB}" stroke-width="1.4" opacity="0.3" transform="rotate(${f(keyRot)} ${f(cx)} ${f(cy)})"/>`,
  );

  /* -- Finish -------------------------------------------------------------- */
  // Grain, then vignette, then the plate line. Order matters: grain sits over
  // the art but under the vignette, so the darkened corners stay clean.
  layers.push(
    `<rect width="${SIZE}" height="${SIZE}" fill="url(#${id("grainpat")})" opacity="${scheme.light ? "0.22" : "0.18"}" style="mix-blend-mode:overlay"/>`,
    `<rect width="${SIZE}" height="${SIZE}" fill="url(#${id("vig")})"/>`,
    `<rect x="34.5" y="34.5" width="${SIZE - 69}" height="${SIZE - 69}" fill="none" stroke="${scheme.accentB}" stroke-width="1" opacity="0.22"/>`,
  );

  const defs = `<defs>
<linearGradient id="${id("ground")}" gradientTransform="rotate(${f(groundAngle)} 0.5 0.5)"><stop offset="0" stop-color="${scheme.ground[0]}"/><stop offset="0.55" stop-color="${scheme.ground[1]}"/><stop offset="1" stop-color="${scheme.ground[2]}"/></linearGradient>
<radialGradient id="${id("bloom")}" cx="${f(glowX)}" cy="${f(glowY)}" r="0.78"><stop offset="0" stop-color="${scheme.glow}" stop-opacity="${scheme.light ? "0.9" : "0.55"}"/><stop offset="1" stop-color="${scheme.glow}" stop-opacity="0"/></radialGradient>
<linearGradient id="${id("sweep")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${scheme.accentA}"/><stop offset="1" stop-color="${scheme.accentB}" stop-opacity="0.15"/></linearGradient>
<linearGradient id="${id("ribbon")}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${scheme.accentB}" stop-opacity="0"/><stop offset="0.5" stop-color="${scheme.accentA}"/><stop offset="1" stop-color="${scheme.accentB}" stop-opacity="0"/></linearGradient>
<radialGradient id="${id("focal")}"><stop offset="0" stop-color="${scheme.accentB}" stop-opacity="0.95"/><stop offset="0.6" stop-color="${scheme.accentA}" stop-opacity="0.35"/><stop offset="1" stop-color="${scheme.accentA}" stop-opacity="0"/></radialGradient>
<radialGradient id="${id("vig")}" cx="0.5" cy="0.5" r="0.78"><stop offset="0.45" stop-color="${scheme.vignette}" stop-opacity="0"/><stop offset="1" stop-color="${scheme.vignette}" stop-opacity="${scheme.light ? "0.3" : "0.72"}"/></radialGradient>
<filter id="${id("haze")}" x="-12%" y="-12%" width="124%" height="124%"><feGaussianBlur stdDeviation="${f(r.range(46, 68))}"/></filter>
<filter id="${id("soft")}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${f(r.range(12, 26))}"/></filter>
<filter id="${id("grain")}" x="0" y="0" width="${GRAIN_TILE}" height="${GRAIN_TILE}" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="${f(r.range(0.65, 0.95))}" numOctaves="2" stitchTiles="stitch" result="n"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.85"/></feComponentTransfer></filter>
<pattern id="${id("grainpat")}" width="${GRAIN_TILE}" height="${GRAIN_TILE}" patternUnits="userSpaceOnUse"><rect width="${GRAIN_TILE}" height="${GRAIN_TILE}" filter="url(#${id("grain")})"/></pattern>
<clipPath id="${id("clip")}"><rect width="${SIZE}" height="${SIZE}"/></clipPath>
<path id="${id("rose")}" d="${rosette}" fill="none" vector-effect="non-scaling-stroke"/>
<path id="${id("fil")}" d="${filigree}" fill="none" vector-effect="non-scaling-stroke"/>
</defs>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-label="Abstract lot artwork">${defs}<g clip-path="url(#${id("clip")})"><rect width="${SIZE}" height="${SIZE}" fill="url(#${id("ground")})"/><rect width="${SIZE}" height="${SIZE}" fill="url(#${id("bloom")})"/>${layers.join("")}</g></svg>`;
}

/* -------------------------------------------------------------------------- */
/* Avatars                                                                     */
/* -------------------------------------------------------------------------- */

const AV = 256;

/** Initials for the monogram. Falls back to base36 so any seed yields glyphs. */
function initialsFor(seed: string): string {
  const words = seed
    .replace(/[^A-Za-z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return hashSeed(seed).toString(36).slice(0, 2).toUpperCase();
}

/**
 * A 256px monogram avatar sharing the lot palettes, so a bidder's chip sits
 * beside their bids without introducing a second colour language.
 */
export function generateAvatar(seed: string): string {
  const scheme = SCHEMES[hashSeed(`avatar:${seed}`) % SCHEMES.length];
  const r = rng(`avatar::${seed}`);
  const uid = (hashSeed(`av#${seed}`) % 46656).toString(36);
  const id = (name: string) => `${name}${uid}`;
  const c = AV / 2;

  const wedges: string[] = [];
  const wedgeCount = r.int(3, 5);
  for (let i = 0; i < wedgeCount; i++) {
    const a0 = r.range(0, Math.PI * 2);
    const a1 = a0 + r.range(0.5, 1.6);
    const rad = r.range(120, 220);
    const x0 = c + Math.cos(a0) * rad;
    const y0 = c + Math.sin(a0) * rad;
    const x1 = c + Math.cos(a1) * rad;
    const y1 = c + Math.sin(a1) * rad;
    wedges.push(
      `<path d="M ${f(c)} ${f(c)} L ${f(x0)} ${f(y0)} A ${f(rad)} ${f(rad)} 0 0 1 ${f(x1)} ${f(y1)} Z" fill="${r.chance(0.5) ? scheme.accentA : scheme.glow}" opacity="${f(r.range(0.1, 0.24))}"/>`,
    );
  }

  const rings: string[] = [];
  for (let i = 0; i < r.int(2, 4); i++) {
    rings.push(
      `<circle cx="${f(c)}" cy="${f(c)}" r="${f(r.range(56, 118))}" fill="none" stroke="${scheme.line}" stroke-width="${f(r.range(0.6, 1.6))}" opacity="${f(r.range(0.2, 0.5))}"/>`,
    );
  }

  // The same rose-engine motif as the lot plates, at a quarter of the point
  // count. It is what ties a 256px chip to the 1200px artwork beside it.
  const avR = r.int(9, 17);
  let avr = r.int(2, 6);
  if (avR % avr === 0) avr += 1;
  const avStack = r.int(4, 9);
  const avUses: string[] = [];
  for (let i = 0; i < avStack; i++) {
    avUses.push(
      `<use href="#${id("r")}" transform="translate(${f(c)} ${f(c)}) rotate(${f((360 / avStack) * i)}) scale(${f(r.range(0.78, 1.05))})"/>`,
    );
  }
  const avPath = hypotrochoidPath(avR, avr, r.range(0.5, 1.8), 112, 240);

  const ink = scheme.light ? scheme.accentA : scheme.accentB;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${AV} ${AV}" width="${AV}" height="${AV}" role="img" aria-label="Monogram avatar"><defs><linearGradient id="${id("g")}" gradientTransform="rotate(${f(r.range(0, 360))} 0.5 0.5)"><stop offset="0" stop-color="${scheme.ground[0]}"/><stop offset="1" stop-color="${scheme.ground[2]}"/></linearGradient><radialGradient id="${id("b")}" cx="${f(r.range(0.25, 0.75))}" cy="${f(r.range(0.2, 0.7))}" r="0.8"><stop offset="0" stop-color="${scheme.glow}" stop-opacity="0.6"/><stop offset="1" stop-color="${scheme.glow}" stop-opacity="0"/></radialGradient><clipPath id="${id("c")}"><rect width="${AV}" height="${AV}"/></clipPath><path id="${id("r")}" d="${avPath}" fill="none" vector-effect="non-scaling-stroke"/></defs><g clip-path="url(#${id("c")})"><rect width="${AV}" height="${AV}" fill="url(#${id("g")})"/><rect width="${AV}" height="${AV}" fill="url(#${id("b")})"/>${wedges.join("")}<g fill="none" stroke="${scheme.line}" stroke-width="0.6" opacity="0.3">${avUses.join("")}</g>${rings.join("")}<text x="${f(c)}" y="${f(c)}" text-anchor="middle" dominant-baseline="central" font-family="Georgia, 'Times New Roman', serif" font-size="88" letter-spacing="4" fill="${ink}" opacity="0.92">${initialsFor(seed)}</text><rect x="0.5" y="0.5" width="${AV - 1}" height="${AV - 1}" fill="none" stroke="${ink}" stroke-width="1" opacity="0.25"/></g></svg>`;
}

/* -------------------------------------------------------------------------- */
/* File output                                                                 */
/* -------------------------------------------------------------------------- */

export const LOTS_DIR = path.resolve(process.cwd(), "public/lots");

/**
 * Write the `count` images for one lot and return the public paths, in the
 * order the seed script should store them in `auctions.images` (first = hero).
 */
export function writeLotArt(slug: string, count: number, dir = LOTS_DIR): string[] {
  mkdirSync(dir, { recursive: true });
  const paths: string[] = [];
  for (let i = 1; i <= count; i++) {
    const file = `${slug}-${i}.svg`;
    writeFileSync(path.join(dir, file), generateLotArt(slug, i), "utf8");
    paths.push(`/lots/${file}`);
  }
  return paths;
}

/**
 * Write one avatar and return its public path.
 *
 * The file is named for the handle but seeded from `label` (the display name),
 * so the monogram reads "AS" for Ava Sinclair rather than the first two
 * letters of "avasinclair".
 */
/**
 * The house plates offered by the consignment wizard.
 *
 * A seller with no photography can pick one of these instead. They are part of
 * the interface, not of any lot, so they are generated from fixed seeds and
 * live at a stable path — and the seed's stale-plate sweep must leave them
 * alone, or the wizard offers twelve broken images.
 */
export const HOUSE_PLATE_COUNT = 12;

export function housePlatePath(index: number): string {
  return `/lots/preview-${String(index + 1).padStart(2, "0")}.svg`;
}

export function writeHousePlates(dir = LOTS_DIR): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (let i = 0; i < HOUSE_PLATE_COUNT; i++) {
    const file = `preview-${String(i + 1).padStart(2, "0")}.svg`;
    writeFileSync(path.join(dir, file), generateLotArt(`house-plate-${i + 1}`, i), "utf8");
    written.push(`/lots/${file}`);
  }
  return written;
}

export function writeAvatar(handle: string, label = handle, dir = LOTS_DIR): string {
  mkdirSync(dir, { recursive: true });
  const file = `avatar-${handle}.svg`;
  writeFileSync(path.join(dir, file), generateAvatar(label), "utf8");
  return `/lots/${file}`;
}

/**
 * Direct invocation. `tsx` may load this as CJS (no `"type": "module"` in
 * package.json), so `import.meta.url` is not dependable here — matching on the
 * entry path is.
 */
const invokedDirectly = /generate-art\.ts$/.test(process.argv[1] ?? "");

if (invokedDirectly) {
  const slugs = process.argv.slice(2);
  if (slugs.length > 0) {
    for (const slug of slugs) {
      const written = writeLotArt(slug, 3);
      console.log(`${slug}: ${written.join(", ")}`);
    }
  } else {
    // No arguments: emit a sample sheet so the generator can be eyeballed
    // without a database. `preview-*` is a reserved prefix the seed never uses.
    mkdirSync(LOTS_DIR, { recursive: true });
    for (let i = 1; i <= 12; i++) {
      const slug = `preview-${String(i).padStart(2, "0")}`;
      writeFileSync(path.join(LOTS_DIR, `${slug}.svg`), generateLotArt(slug, 1), "utf8");
    }
    writeAvatar("preview-monogram");
    console.log(`Wrote 12 preview lots + 1 avatar to ${LOTS_DIR}`);
  }
}
