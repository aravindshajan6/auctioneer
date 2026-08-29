"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LotMedia } from "./lot-media";

/**
 * The catalogue plate and its details.
 *
 * The lightbox is a native <dialog>: `showModal()` gives us the focus trap,
 * the inert background and Escape-to-close for free, and returns focus to the
 * trigger on close. Re-implementing that by hand is how galleries end up
 * unusable with a keyboard.
 */
export function LotGallery({
  images,
  title,
  accent,
  lotNumber,
}: {
  images: string[];
  title: string;
  accent?: string | null;
  lotNumber?: number | null;
}) {
  const plates = images.length > 0 ? images : [""];
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const current = plates[Math.min(index, plates.length - 1)] ?? "";

  function step(delta: number) {
    setIndex((i) => (i + delta + plates.length) % plates.length);
  }

  function openLightbox() {
    dialogRef.current?.showModal();
    setZoomed(true);
  }

  // Keep React's idea of "open" in step with a dialog dismissed by Escape or
  // by a backdrop click, which close it without going through our handler.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => setZoomed(false);
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  function onStripKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    }
  }

  return (
    <div className="space-y-3" onKeyDown={onStripKeyDown}>
      <div className="group relative overflow-hidden rounded-2xl border border-pewter/45">
        <LotMedia
          src={current || null}
          alt={`${title} — view ${index + 1} of ${plates.length}`}
          accent={accent}
          loading="eager"
          sizes="(min-width: 1024px) 58vw, 100vw"
          className="aspect-[4/3] w-full sm:aspect-[5/4]"
          imgClassName="object-contain"
        />

        {lotNumber !== null && lotNumber !== undefined && (
          <span className="pointer-events-none absolute left-4 top-4 rounded-full bg-void/75 px-3 py-1 font-display text-xs tracking-[0.14em] text-gild-200 backdrop-blur-md">
            LOT {String(lotNumber).padStart(3, "0")}
          </span>
        )}

        <button
          type="button"
          onClick={openLightbox}
          className="absolute right-4 top-4 inline-flex size-10 items-center justify-center rounded-full border border-pewter/60 bg-void/75 text-fog backdrop-blur-md transition-colors hover:border-gild-500/60 hover:text-linen"
          aria-label="Enlarge image"
        >
          <Expand className="size-4" aria-hidden />
        </button>

        {plates.length > 1 && (
          <>
            <GalleryArrow side="left" onClick={() => step(-1)} label="Previous image" />
            <GalleryArrow side="right" onClick={() => step(1)} label="Next image" />
          </>
        )}
      </div>

      {plates.length > 1 && (
        <div
          role="group"
          aria-label="Additional views"
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {plates.map((plate, i) => (
            <button
              key={`${plate}-${i}`}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`View ${i + 1} of ${plates.length}`}
              aria-current={i === index}
              className={cn(
                "shrink-0 overflow-hidden rounded-xl border transition-colors duration-200",
                i === index
                  ? "border-gild-400/80"
                  : "border-pewter/45 opacity-70 hover:border-pewter hover:opacity-100",
              )}
            >
              <LotMedia
                src={plate || null}
                alt=""
                accent={accent}
                className="size-16 sm:size-20"
              />
            </button>
          ))}
        </div>
      )}

      <dialog
        ref={dialogRef}
        aria-label={`${title} — enlarged`}
        className="m-auto max-h-[92vh] w-[min(96vw,1200px)] rounded-2xl border border-pewter/50 bg-obsidian p-0 text-linen backdrop:bg-void/90 backdrop:backdrop-blur-sm"
        onKeyDown={onStripKeyDown}
        onClick={(event) => {
          // A click that lands on the dialog itself landed on its backdrop —
          // the content is all in the child below.
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        {zoomed && (
          <div className="flex max-h-[92vh] flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-pewter/40 px-4 py-3">
              <p className="truncate font-display text-sm text-linen">{title}</p>
              <div className="flex items-center gap-2">
                <span className="tabular text-xs text-ash">
                  {index + 1} / {plates.length}
                </span>
                <button
                  type="button"
                  onClick={() => dialogRef.current?.close()}
                  className="inline-flex size-9 items-center justify-center rounded-full text-fog transition-colors hover:bg-white/5 hover:text-linen"
                  aria-label="Close enlarged view"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            </div>

            <div className="relative flex-1 overflow-hidden">
              <LotMedia
                src={current || null}
                alt={`${title} — view ${index + 1} of ${plates.length}`}
                accent={accent}
                loading="eager"
                className="max-h-[76vh] w-full"
                imgClassName="object-contain max-h-[76vh]"
              />
              {plates.length > 1 && (
                <>
                  <GalleryArrow side="left" onClick={() => step(-1)} label="Previous image" />
                  <GalleryArrow side="right" onClick={() => step(1)} label="Next image" />
                </>
              )}
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

function GalleryArrow({
  side,
  onClick,
  label,
}: {
  side: "left" | "right";
  onClick: () => void;
  label: string;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full",
        "border border-pewter/60 bg-void/75 text-fog backdrop-blur-md transition-colors",
        "hover:border-gild-500/60 hover:text-linen",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
