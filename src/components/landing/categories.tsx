import Link from "next/link";
import type { CSSProperties } from "react";
import {
  Amphora,
  Armchair,
  BookOpen,
  Brush,
  Camera,
  Car,
  Clapperboard,
  Coins,
  Compass,
  Crown,
  Diamond,
  Disc3,
  Feather,
  Frame,
  Gem,
  Guitar,
  Hammer,
  Landmark,
  Layers,
  Leaf,
  Medal,
  Music,
  Palette,
  Scroll,
  Shapes,
  Ship,
  Shirt,
  Sparkles,
  Stamp,
  Swords,
  Telescope,
  Trophy,
  Watch,
  Wine,
  type LucideIcon,
} from "lucide-react";

export interface CategoryTile {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  accent: string;
  icon: string | null;
}

/**
 * The `icon` column holds a lucide name chosen by whoever seeded the
 * catalogue, so it is untrusted input as far as this component is concerned.
 * An explicit table beats `import * as lucide` — it fails to a sensible glyph
 * instead of `undefined`, and it does not drag the entire icon set into the
 * bundle.
 */
const ICONS: Record<string, LucideIcon> = {
  amphora: Amphora,
  antiquities: Amphora,
  armchair: Armchair,
  art: Palette,
  bookopen: BookOpen,
  books: BookOpen,
  brush: Brush,
  camera: Camera,
  car: Car,
  clapperboard: Clapperboard,
  coins: Coins,
  compass: Compass,
  crown: Crown,
  diamond: Diamond,
  disc3: Disc3,
  feather: Feather,
  frame: Frame,
  furniture: Armchair,
  gem: Gem,
  guitar: Guitar,
  hammer: Hammer,
  jewellery: Gem,
  jewelry: Gem,
  landmark: Landmark,
  layers: Layers,
  leaf: Leaf,
  medal: Medal,
  music: Music,
  palette: Palette,
  scroll: Scroll,
  shapes: Shapes,
  ship: Ship,
  shirt: Shirt,
  sparkles: Sparkles,
  stamp: Stamp,
  swords: Swords,
  telescope: Telescope,
  trophy: Trophy,
  vinyl: Disc3,
  watch: Watch,
  watches: Watch,
  wine: Wine,
};

function iconFor(name: string | null): LucideIcon {
  if (!name) return Sparkles;
  return ICONS[name.replace(/[^a-z0-9]/gi, "").toLowerCase()] ?? Sparkles;
}

export function CategoryGrid({ categories }: { categories: CategoryTile[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {categories.map((category) => {
        const Icon = iconFor(category.icon);
        return (
          <li key={category.id}>
            <Link
              href={`/explore?category=${category.slug}`}
              // The accent travels as a custom property so every tinted surface
              // in the card derives from one value rather than four hard-coded
              // near-misses.
              style={{ "--accent": category.accent } as CSSProperties}
              className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-pewter/45 bg-obsidian/70 p-5 transition-[border-color,transform,background] duration-300 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--accent)_55%,transparent)] hover:bg-[color-mix(in_oklab,var(--accent)_7%,var(--color-obsidian))]"
            >
              <span
                className="pointer-events-none absolute -top-16 -right-16 size-36 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-45 bg-[var(--accent)]"
                aria-hidden
              />
              <span
                className="relative flex size-10 items-center justify-center rounded-xl border border-[color-mix(in_oklab,var(--accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--accent)_14%,transparent)]"
                aria-hidden
              >
                <Icon className="size-[18px] text-[var(--accent)]" />
              </span>

              <h3 className="relative mt-4 font-display text-[15px] font-semibold text-linen">
                {category.name}
              </h3>
              {category.description && (
                <p className="relative mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-ash">
                  {category.description}
                </p>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
