"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { incrementFor, minimumNextBid } from "@/lib/auction/increments";
import { formatCents, parseToCents } from "@/lib/auction/money";
import { cn } from "@/lib/utils";
import { LotThumb } from "./lot-thumb";

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

export interface CategoryOption {
  id: string;
  name: string;
  slug: string;
}

export interface AntiSnipeConfig {
  windowSeconds: number;
  extensionSeconds: number;
}

type Condition = "mint" | "excellent" | "good" | "fair" | "restoration";

const CONDITIONS: ReadonlyArray<{ value: Condition; label: string; note: string }> = [
  { value: "mint", label: "Mint", note: "As it left the workshop. Unused, unworn, complete." },
  { value: "excellent", label: "Excellent", note: "Light honest wear, nothing a buyer would remark on." },
  { value: "good", label: "Good", note: "Visible use consistent with age. Structurally sound." },
  { value: "fair", label: "Fair", note: "Faults you must describe. Still whole, still usable." },
  { value: "restoration", label: "Restoration", note: "Sold as a project. Say plainly what is broken." },
];

const DURATIONS: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 120, label: "5 days" },
  { hours: 168, label: "7 days" },
  { hours: 240, label: "10 days" },
  { hours: 336, label: "14 days" },
];

/** The house plates shipped in /public/lots, for sellers with nothing to hand. */
const HOUSE_PLATES = Array.from(
  { length: 12 },
  (_, i) => `/lots/preview-${String(i + 1).padStart(2, "0")}.svg`,
);

type Field =
  | "title"
  | "categoryId"
  | "condition"
  | "description"
  | "provenance"
  | "images"
  | "startingPrice"
  | "reservePrice"
  | "buyNowPrice"
  | "startsAt"
  | "durationHours";

type Errors = Partial<Record<Field, string>>;

/**
 * Which DOM input owns each field, so a failed submit can put the caret on the
 * first thing that is wrong. Ids rather than a record of refs: the steps are
 * separate components and a ref lookup object reads as ref access during
 * render, which React's lint rule flags (correctly).
 */
const FIELD_INPUT_ID: Partial<Record<Field, string>> = {
  title: "lot-title",
  categoryId: "lot-category",
  condition: "lot-condition",
  description: "lot-description",
  images: "lot-image-url",
  startingPrice: "lot-starting",
  reservePrice: "lot-reserve",
  buyNowPrice: "lot-buynow",
  startsAt: "lot-starts-at",
  durationHours: "lot-duration",
};

interface Draft {
  title: string;
  categoryId: string;
  condition: Condition;
  description: string;
  provenance: string;
  images: string[];
  imageDraft: string;
  startingPrice: string;
  reservePrice: string;
  buyNowPrice: string;
  type: "timed" | "live";
  startMode: "now" | "later";
  startsAt: string;
  durationHours: number;
}

interface StepSpec {
  id: number;
  label: string;
  /** Which fields this step owns, so a server-side error can jump to it. */
  fields: readonly Field[];
}

const STEPS: readonly StepSpec[] = [
  { id: 1, label: "Item", fields: ["title", "categoryId", "condition", "description", "provenance"] },
  { id: 2, label: "Images", fields: ["images"] },
  { id: 3, label: "Pricing", fields: ["startingPrice", "reservePrice", "buyNowPrice"] },
  { id: 4, label: "Schedule", fields: ["startsAt", "durationHours"] },
  { id: 5, label: "Review", fields: [] },
];

const MIN_STARTING_CENTS = 100;

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * These rules are a courtesy, not a gate — `/api/lots` re-checks every one of
 * them. Duplicating them here buys an inline error instead of a round trip,
 * and nothing more.
 */
function validate(step: number, draft: Draft, hasCategories: boolean): Errors {
  const errors: Errors = {};

  if (step === 1 || step === 5) {
    if (draft.title.trim().length < 4) errors.title = "Give the lot a title of at least four characters.";
    else if (draft.title.trim().length > 140) errors.title = "Titles run to 140 characters at most.";
    if (hasCategories && !draft.categoryId) errors.categoryId = "Pick the department this belongs in.";
    if (draft.description.trim().length < 10) {
      errors.description = "Say something about it — condition, size, what it is. Ten characters minimum.";
    }
  }

  if (step === 2 || step === 5) {
    if (draft.images.length === 0) errors.images = "A lot needs at least one image.";
  }

  if (step === 3 || step === 5) {
    const starting = parseToCents(draft.startingPrice);
    if (starting === null) errors.startingPrice = "Enter a starting price.";
    else if (starting < MIN_STARTING_CENTS) errors.startingPrice = "The starting price must be at least $1.";

    if (draft.reservePrice.trim()) {
      const reserve = parseToCents(draft.reservePrice);
      if (reserve === null) errors.reservePrice = "That is not a valid amount.";
      else if (starting !== null && reserve < starting) {
        errors.reservePrice = "A reserve below the starting price would let the lot sell under its own floor.";
      }
    }

    if (draft.buyNowPrice.trim()) {
      const buyNow = parseToCents(draft.buyNowPrice);
      const reserve = draft.reservePrice.trim() ? parseToCents(draft.reservePrice) : null;
      if (buyNow === null) errors.buyNowPrice = "That is not a valid amount.";
      else if (starting !== null && buyNow <= starting) {
        errors.buyNowPrice = "Buy Now must be above the starting price, or nobody would ever bid.";
      } else if (reserve !== null && buyNow < reserve) {
        errors.buyNowPrice = "Buy Now cannot sit below your reserve.";
      }
    }
  }

  if (step === 4 || step === 5) {
    if (draft.startMode === "later") {
      const at = new Date(draft.startsAt);
      if (!draft.startsAt || Number.isNaN(at.getTime())) errors.startsAt = "Choose when bidding opens.";
      else if (at.getTime() < Date.now() - 60_000) errors.startsAt = "That moment has already passed.";
      else if (at.getTime() > Date.now() + 90 * 86_400_000) {
        errors.startsAt = "We cannot schedule more than 90 days out.";
      }
    }
    if (!Number.isInteger(draft.durationHours) || draft.durationHours < 1 || draft.durationHours > 720) {
      errors.durationHours = "Run the lot for between 1 and 720 hours.";
    }
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/* Wizard                                                                      */
/* -------------------------------------------------------------------------- */

interface CreateLotResponse {
  ok: boolean;
  message?: string;
  field?: string;
  lot?: { slug: string; status: string };
  issues?: Array<{ path: string; message: string }>;
}

export function SellWizard({
  categories,
  antiSnipe,
}: {
  categories: CategoryOption[];
  antiSnipe: AntiSnipeConfig;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState(1);
  const [errors, setErrors] = React.useState<Errors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>({
    title: "",
    categoryId: "",
    condition: "excellent",
    description: "",
    provenance: "",
    images: [],
    imageDraft: "",
    startingPrice: "",
    reservePrice: "",
    buyNowPrice: "",
    type: "timed",
    startMode: "now",
    startsAt: "",
    durationHours: 168,
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }) as Draft);
    // Red on a field somebody is actively fixing reads as "still wrong".
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key as Field];
      return next;
    });
  };

  /**
   * Switching to a scheduled start seeds the field with the next round hour.
   * Done in the event handler rather than an effect so nothing clock-derived
   * is ever produced during render — SSR and hydration would disagree.
   */
  const chooseStartMode = (mode: "now" | "later") => {
    setDraft((prev) => {
      if (mode === "now" || prev.startsAt) return { ...prev, startMode: mode };
      const next = new Date(Date.now() + 3_600_000);
      next.setMinutes(0, 0, 0);
      return { ...prev, startMode: mode, startsAt: toLocalInput(next) };
    });
  };

  function focusFirstError(found: Errors) {
    const order: Field[] = [
      "title", "categoryId", "description", "images",
      "startingPrice", "reservePrice", "buyNowPrice", "startsAt", "durationHours",
    ];
    const first = order.find((f) => found[f]);
    const id = first ? FIELD_INPUT_ID[first] : undefined;
    if (id) document.getElementById(id)?.focus();
  }

  function goTo(next: number) {
    if (next < step) {
      setStep(next);
      return;
    }
    // Moving forward means every step behind you has to be clean.
    for (let s = step; s < next; s++) {
      const found = validate(s, draft, categories.length > 0);
      if (Object.keys(found).length > 0) {
        setStep(s);
        setErrors(found);
        window.requestAnimationFrame(() => focusFirstError(found));
        return;
      }
    }
    setErrors({});
    setStep(next);
  }

  const startISO = React.useMemo(() => {
    if (draft.startMode === "now") return null; // resolved at submit
    const at = new Date(draft.startsAt);
    return Number.isNaN(at.getTime()) ? null : at.toISOString();
  }, [draft.startMode, draft.startsAt]);

  async function submit() {
    const found = validate(5, draft, categories.length > 0);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      const stepWithError = STEPS.find((s) => s.fields.some((f) => found[f]));
      if (stepWithError) setStep(stepWithError.id);
      window.requestAnimationFrame(() => focusFirstError(found));
      return;
    }

    setFormError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/lots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description.trim(),
          provenance: draft.provenance.trim() || null,
          categoryId: draft.categoryId || null,
          condition: draft.condition,
          images: draft.images,
          // Sent as the seller typed them; the server owns the conversion to
          // integer cents so there is exactly one implementation of it.
          startingPrice: draft.startingPrice,
          reservePrice: draft.reservePrice.trim() || null,
          buyNowPrice: draft.buyNowPrice.trim() || null,
          type: draft.type,
          startsAt: startISO ?? new Date().toISOString(),
          durationHours: draft.durationHours,
        }),
      });
      const payload = (await response.json()) as CreateLotResponse;

      if (!response.ok || !payload.ok || !payload.lot) {
        const message =
          payload.issues?.[0]?.message ?? payload.message ?? "We could not list that lot.";
        const field = payload.field as Field | undefined;
        if (field && field in FIELD_INPUT_ID) {
          setErrors({ [field]: message });
          const owner = STEPS.find((s) => s.fields.includes(field));
          if (owner) setStep(owner.id);
          window.requestAnimationFrame(() => focusFirstError({ [field]: message }));
        }
        setFormError(message);
        setSubmitting(false);
        return;
      }

      toast.success(
        payload.lot.status === "scheduled" ? "Lot scheduled." : "Lot is live.",
        { description: draft.title.trim() },
      );
      router.push(`/lot/${payload.lot.slug}`);
      router.refresh();
    } catch {
      setFormError("The listing did not reach us. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  const startingCents = parseToCents(draft.startingPrice);
  const reserveCents = draft.reservePrice.trim() ? parseToCents(draft.reservePrice) : null;
  const buyNowCents = draft.buyNowPrice.trim() ? parseToCents(draft.buyNowPrice) : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
      <div>
        <StepNav step={step} onGoTo={goTo} />

        {formError && (
          <p
            role="alert"
            className="mt-6 flex items-start gap-2 rounded-xl border border-ember-500/45 bg-ember-500/10 px-3.5 py-3 text-[13px] text-ember-300"
          >
            <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
            {formError}
          </p>
        )}

        <div className="mt-8">
          {step === 1 && (
            <StepItem
              draft={draft}
              errors={errors}
              set={set}
              categories={categories}
            />
          )}
          {step === 2 && <StepImages draft={draft} errors={errors} set={set} />}
          {step === 3 && (
            <StepPricing
              draft={draft}
              errors={errors}
              set={set}
              startingCents={startingCents}
            />
          )}
          {step === 4 && (
            <StepSchedule
              draft={draft}
              errors={errors}
              set={set}
              antiSnipe={antiSnipe}
              onStartMode={chooseStartMode}
            />
          )}
          {step === 5 && (
            <StepReview
              draft={draft}
              categories={categories}
              startingCents={startingCents}
              reserveCents={reserveCents}
              buyNowCents={buyNowCents}
              startISO={startISO}
              onEdit={setStep}
            />
          )}
        </div>

        <div className="mt-10 flex items-center justify-between gap-3 border-t border-pewter/40 pt-6">
          <Button
            type="button"
            variant="ghost"
            onClick={() => goTo(Math.max(1, step - 1))}
            disabled={step === 1 || submitting}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </Button>
          {step < 5 ? (
            <Button type="button" variant="gild" size="lg" onClick={() => goTo(step + 1)}>
              Continue
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button
              type="button"
              variant="gild"
              size="lg"
              loading={submitting}
              onClick={() => void submit()}
            >
              Put it on the block
            </Button>
          )}
        </div>
      </div>

      <PreviewCard
        draft={draft}
        categories={categories}
        startingCents={startingCents}
        reserveCents={reserveCents}
        buyNowCents={buyNowCents}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Step navigation                                                             */
/* -------------------------------------------------------------------------- */

function StepNav({ step, onGoTo }: { step: number; onGoTo: (n: number) => void }) {
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2" aria-label="Listing steps">
      {STEPS.map((s) => {
        const state = s.id === step ? "current" : s.id < step ? "done" : "todo";
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onGoTo(s.id)}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
                state === "current" && "border-gild-500/60 bg-gild-500/12 text-gild-100",
                state === "done" && "border-pewter/50 text-fog hover:border-gild-500/50",
                state === "todo" && "border-transparent text-ash hover:text-fog",
              )}
            >
              <span
                className={cn(
                  "tabular flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]",
                  state === "current" && "bg-gild-400 text-obsidian",
                  state === "done" && "bg-gild-500/25 text-gild-200",
                  state === "todo" && "bg-white/[0.06] text-ash",
                )}
              >
                {state === "done" ? <Check className="size-3" aria-hidden /> : s.id}
              </span>
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 1 — Item                                                               */
/* -------------------------------------------------------------------------- */

interface StepProps {
  draft: Draft;
  errors: Errors;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}

function StepItem({
  draft,
  errors,
  set,
  categories,
}: StepProps & { categories: CategoryOption[] }) {
  const condition = CONDITIONS.find((c) => c.value === draft.condition)!;
  return (
    <section aria-labelledby="step-item-heading" className="space-y-6">
      <header>
        <h2 id="step-item-heading" className="font-display text-2xl font-semibold text-linen">
          What are you selling?
        </h2>
        <p className="mt-1.5 text-sm text-ash">
          Catalogue copy earns money. Name the maker, the model and the year in the title if you
          know them — that is what buyers search.
        </p>
      </header>

      <div>
        <Label htmlFor="lot-title">Title</Label>
        <Input
          id="lot-title"
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={140}
          placeholder="Leica M3 double-stroke, 1955, with 50mm Summicron"
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? "lot-title-error" : undefined}
          className="aria-[invalid=true]:border-ember-500/70"
        />
        <div className="mt-1.5 flex items-start justify-between gap-4">
          <span id="lot-title-error" className="flex-1">
            <FieldError>{errors.title}</FieldError>
          </span>
          <span className="tabular shrink-0 text-[11px] text-ash">{draft.title.length}/140</span>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="lot-category">Department</Label>
          <Select
            id="lot-category"
            value={draft.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
            aria-invalid={Boolean(errors.categoryId)}
            aria-describedby={errors.categoryId ? "lot-category-error" : undefined}
          >
            <option value="">Choose a department…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <span id="lot-category-error">
            <FieldError>{errors.categoryId}</FieldError>
          </span>
        </div>

        <div>
          <Label htmlFor="lot-condition">Condition</Label>
          <Select
            id="lot-condition"
            value={draft.condition}
            onChange={(e) => set("condition", e.target.value as Condition)}
            aria-describedby="lot-condition-note"
          >
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <p id="lot-condition-note" className="mt-1.5 text-[12px] leading-snug text-ash">
            {condition.note}
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor="lot-description">Description</Label>
        <Textarea
          id="lot-description"
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
          rows={7}
          placeholder="Dimensions, materials, marks and signatures, what works and what does not. Faults declared here are faults that cannot be disputed later."
          aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? "lot-description-error" : undefined}
          className="aria-[invalid=true]:border-ember-500/70"
        />
        <span id="lot-description-error">
          <FieldError>{errors.description}</FieldError>
        </span>
      </div>

      <div>
        <Label htmlFor="lot-provenance">Provenance (optional)</Label>
        <Textarea
          id="lot-provenance"
          value={draft.provenance}
          onChange={(e) => set("provenance", e.target.value)}
          rows={3}
          placeholder="Purchased from the Bond Street dealer in 1998; by descent from the original owner; accompanied by the 1955 receipt."
        />
        <p className="mt-1.5 text-[12px] leading-snug text-ash">
          A chain of ownership is the difference between a good price and a very good one. Say
          only what you can support.
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 2 — Images                                                             */
/* -------------------------------------------------------------------------- */

function StepImages({ draft, errors, set }: StepProps) {
  const addImage = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (draft.images.includes(trimmed)) return;
    if (draft.images.length >= 8) return;
    set("images", [...draft.images, trimmed]);
    set("imageDraft", "");
  };

  const move = (index: number, delta: number) => {
    const next = [...draft.images];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    set("images", next);
  };

  const remove = (index: number) => set("images", draft.images.filter((_, i) => i !== index));
  const makeHero = (index: number) => {
    if (index === 0) return;
    const next = [...draft.images];
    const [picked] = next.splice(index, 1);
    set("images", [picked!, ...next]);
  };

  return (
    <section aria-labelledby="step-images-heading" className="space-y-6">
      <header>
        <h2 id="step-images-heading" className="font-display text-2xl font-semibold text-linen">
          Photographs
        </h2>
        <p className="mt-1.5 text-sm text-ash">
          The first image is the hero — it is the one the catalogue, the search results and every
          shared link use. Reorder them below until the right one is first.
        </p>
      </header>

      {/* Being straight about what this build does and does not do is better
          than a drop zone that swallows files and reports success. */}
      <p className="rounded-xl border border-pewter/50 bg-white/[0.02] px-4 py-3 text-[13px] leading-relaxed text-fog">
        Direct upload is not wired up in this build. Paste the address of an image you already
        host, a path inside this app such as{" "}
        <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[12px] text-linen">
          /lots/preview-03.svg
        </code>
        , or pick one of the house plates below.
      </p>

      <div>
        <Label htmlFor="lot-image-url">Image address</Label>
        <div className="flex gap-2">
          <Input
            id="lot-image-url"
            value={draft.imageDraft}
            onChange={(e) => set("imageDraft", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addImage(draft.imageDraft);
              }
            }}
            placeholder="https://… or /lots/preview-01.svg"
            inputMode="url"
            aria-invalid={Boolean(errors.images)}
            aria-describedby={errors.images ? "lot-images-error" : undefined}
            className="aria-[invalid=true]:border-ember-500/70"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => addImage(draft.imageDraft)}
            disabled={!draft.imageDraft.trim() || draft.images.length >= 8}
          >
            <ImagePlus className="size-4" aria-hidden />
            Add
          </Button>
        </div>
        <span id="lot-images-error">
          <FieldError>{errors.images}</FieldError>
        </span>
        <p className="mt-1.5 text-[12px] text-ash">
          {draft.images.length} of 8 added. Press Enter to add without leaving the field.
        </p>
      </div>

      {draft.images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {draft.images.map((src, index) => (
            <li
              key={src}
              className={cn(
                "group relative overflow-hidden rounded-xl border",
                index === 0 ? "border-gild-500/60" : "border-pewter/45",
              )}
            >
              <div className="aspect-4/3 bg-slate-deep">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`Image ${index + 1}${index === 0 ? " (hero)" : ""}`}
                  className="size-full object-cover"
                />
              </div>
              {index === 0 && (
                <Badge tone="gild" className="absolute top-2 left-2">
                  Hero
                </Badge>
              )}
              <div className="flex items-center justify-between gap-1 border-t border-pewter/40 bg-obsidian/90 px-2 py-1.5">
                <div className="flex gap-0.5">
                  <IconAction
                    label={`Move image ${index + 1} earlier`}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                  </IconAction>
                  <IconAction
                    label={`Move image ${index + 1} later`}
                    onClick={() => move(index, 1)}
                    disabled={index === draft.images.length - 1}
                  >
                    <ChevronRight className="size-4" aria-hidden />
                  </IconAction>
                </div>
                <div className="flex gap-0.5">
                  <IconAction
                    label={`Make image ${index + 1} the hero`}
                    onClick={() => makeHero(index)}
                    disabled={index === 0}
                  >
                    <Star className="size-4" aria-hidden />
                  </IconAction>
                  <IconAction
                    label={`Remove image ${index + 1}`}
                    onClick={() => remove(index)}
                    tone="danger"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </IconAction>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div>
        <h3 className="text-[11px] font-medium tracking-[0.12em] text-ash uppercase">
          House plates
        </h3>
        <p className="mt-1.5 text-[12px] text-ash">
          Generated catalogue artwork bundled with this app. Useful for trying the flow.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {HOUSE_PLATES.map((plate) => {
            const used = draft.images.includes(plate);
            return (
              <li key={plate}>
                <button
                  type="button"
                  onClick={() => addImage(plate)}
                  disabled={used || draft.images.length >= 8}
                  aria-label={`Add house plate ${plate}`}
                  className={cn(
                    "size-14 overflow-hidden rounded-lg border transition-opacity",
                    used ? "border-gild-500/60 opacity-40" : "border-pewter/45 hover:border-gild-500/60",
                  )}
                >
                  <LotThumb src={plate} alt="" className="size-full rounded-none ring-0" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  tone = "neutral",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-md transition-colors disabled:opacity-30",
        tone === "danger"
          ? "text-ash hover:bg-ember-500/15 hover:text-ember-300"
          : "text-ash hover:bg-white/[0.07] hover:text-linen",
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 3 — Pricing                                                            */
/* -------------------------------------------------------------------------- */

function StepPricing({
  draft,
  errors,
  set,
  startingCents,
}: StepProps & { startingCents: number | null }) {
  // The ladder is computed from the real engine module, so this guidance can
  // never drift away from what the bid endpoint will actually enforce.
  const opening = startingCents ?? 0;
  const step1 = incrementFor(opening);
  const secondBid = minimumNextBid({
    currentPriceCents: opening,
    startingPriceCents: opening,
    hasBids: true,
  });
  const thirdBid = secondBid + incrementFor(secondBid);

  return (
    <section aria-labelledby="step-pricing-heading" className="space-y-6">
      <header>
        <h2 id="step-pricing-heading" className="font-display text-2xl font-semibold text-linen">
          Pricing
        </h2>
        <p className="mt-1.5 text-sm text-ash">
          Open low and let the room find the price. A cheap opening bid attracts bidders; a
          reserve is what protects you from them.
        </p>
      </header>

      <div>
        <Label htmlFor="lot-starting">Starting price</Label>
        <MoneyInput
          id="lot-starting"
          value={draft.startingPrice}
          onChange={(v) => set("startingPrice", v)}
          placeholder="750"
          invalid={Boolean(errors.startingPrice)}
          describedBy={errors.startingPrice ? "lot-starting-error" : undefined}
        />
        <span id="lot-starting-error">
          <FieldError>{errors.startingPrice}</FieldError>
        </span>

        {startingCents !== null && startingCents >= MIN_STARTING_CENTS && (
          <div className="mt-3 rounded-xl border border-gild-600/40 bg-gild-500/[0.06] px-4 py-3.5">
            <h3 className="text-[11px] font-medium tracking-[0.12em] text-gild-200 uppercase">
              The increment ladder
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-fog">
              At {formatCents(startingCents)} the house raises in steps of{" "}
              <span className="tabular font-semibold text-gild-100">{formatCents(step1)}</span>. The
              first bid may be exactly your starting price — nobody should have to beat a price no
              one has offered. After that the ask climbs:
            </p>
            <ol className="tabular mt-3 flex flex-wrap gap-x-2 gap-y-1 text-[13px] text-linen">
              <li className="rounded-md bg-white/[0.05] px-2 py-1">{formatCents(startingCents)}</li>
              <li aria-hidden className="px-0.5 text-ash">→</li>
              <li className="rounded-md bg-white/[0.05] px-2 py-1">{formatCents(secondBid)}</li>
              <li aria-hidden className="px-0.5 text-ash">→</li>
              <li className="rounded-md bg-white/[0.05] px-2 py-1">{formatCents(thirdBid)}</li>
            </ol>
            <p className="mt-2.5 text-[12px] leading-relaxed text-ash">
              The step widens as the price does — $5 under $100, $500 past $10,000 — so a lot at
              $50,000 is never advanced in pocket change.
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <Label htmlFor="lot-reserve">Reserve (optional)</Label>
          <MoneyInput
            id="lot-reserve"
            value={draft.reservePrice}
            onChange={(v) => set("reservePrice", v)}
            placeholder="No reserve"
            invalid={Boolean(errors.reservePrice)}
            describedBy={errors.reservePrice ? "lot-reserve-error" : undefined}
          />
          <span id="lot-reserve-error">
            <FieldError>{errors.reservePrice}</FieldError>
          </span>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ash">
            A sealed floor. Bidders are told whether it has been met — never what it is. If the
            highest maximum never reaches it, the lot <strong className="text-fog">passes
            unsold</strong> and no money changes hands. The moment a bidder&apos;s ceiling does cover
            it, the ask jumps straight to the reserve.
          </p>
        </div>

        <div>
          <Label htmlFor="lot-buynow">Buy Now (optional)</Label>
          <MoneyInput
            id="lot-buynow"
            value={draft.buyNowPrice}
            onChange={(v) => set("buyNowPrice", v)}
            placeholder="No Buy Now"
            invalid={Boolean(errors.buyNowPrice)}
            describedBy={errors.buyNowPrice ? "lot-buynow-error" : undefined}
          />
          <span id="lot-buynow-error">
            <FieldError>{errors.buyNowPrice}</FieldError>
          </span>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ash">
            Ends the lot immediately at a fixed price — but only while it has{" "}
            <strong className="text-fog">no bids</strong>. Once the room has started, the price
            belongs to the room and the option disappears.
          </p>
        </div>
      </div>

      <p className="text-[12.5px] leading-relaxed text-ash">
        Buyers pay a 10% buyer&apos;s premium on top of the hammer price. It does not come out of
        your proceeds, but it does sit in the buyer&apos;s head when they set their maximum.
      </p>
    </section>
  );
}

function MoneyInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  describedBy,
  inputRef,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute top-0 left-3.5 flex h-11 items-center text-sm text-ash"
        aria-hidden
      >
        $
      </span>
      <Input
        id={id}
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={cn("tabular pl-7", invalid && "border-ember-500/70")}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 4 — Schedule                                                           */
/* -------------------------------------------------------------------------- */

function StepSchedule({
  draft,
  errors,
  set,
  antiSnipe,
  onStartMode,
}: StepProps & { antiSnipe: AntiSnipeConfig; onStartMode: (mode: "now" | "later") => void }) {
  // A scheduled start is a value the seller typed, so it is safe to render.
  // An immediate start is "whenever submit happens", which has no date yet —
  // and inventing one during render is how hydration mismatches begin.
  const scheduledStartMs =
    draft.startMode === "later" ? new Date(draft.startsAt).getTime() : null;
  const endMs =
    scheduledStartMs !== null && Number.isFinite(scheduledStartMs)
      ? scheduledStartMs + draft.durationHours * 3_600_000
      : null;

  return (
    <section aria-labelledby="step-schedule-heading" className="space-y-6">
      <header>
        <h2 id="step-schedule-heading" className="font-display text-2xl font-semibold text-linen">
          When it runs
        </h2>
        <p className="mt-1.5 text-sm text-ash">
          Lots close best in the evening, when the people who want them are not at work.
        </p>
      </header>

      <fieldset>
        <legend className="mb-2 text-[11px] font-medium tracking-[0.1em] text-ash uppercase">
          Auction type
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <RadioCard
            name="lot-type"
            value="timed"
            checked={draft.type === "timed"}
            onChange={() => set("type", "timed")}
            title="Timed"
            body="Runs on a clock. Bidders leave maximums and the house works them automatically. Anti-snipe protection applies."
          />
          <RadioCard
            name="lot-type"
            value="live"
            checked={draft.type === "live"}
            onChange={() => set("type", "live")}
            title="Live sale"
            body="Worked from the rostrum in a scheduled sale, lot by lot. The auctioneer decides when it is closed, so the clock is a guide."
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-[11px] font-medium tracking-[0.1em] text-ash uppercase">
          Bidding opens
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <RadioCard
            name="lot-start"
            value="now"
            checked={draft.startMode === "now"}
            onChange={() => onStartMode("now")}
            title="Immediately"
            body="The lot goes live the moment you submit."
          />
          <RadioCard
            name="lot-start"
            value="later"
            checked={draft.startMode === "later"}
            onChange={() => onStartMode("later")}
            title="At a set time"
            body="Published straight away, but sealed until the clock starts."
          />
        </div>

        {draft.startMode === "later" && (
          <div className="mt-4 max-w-sm">
            <Label htmlFor="lot-starts-at">Start time (your local time)</Label>
            <Input
              id="lot-starts-at"
              type="datetime-local"
              value={draft.startsAt}
              onChange={(e) => set("startsAt", e.target.value)}
              aria-invalid={Boolean(errors.startsAt)}
              aria-describedby={errors.startsAt ? "lot-starts-at-error" : undefined}
              className="aria-[invalid=true]:border-ember-500/70"
            />
            <span id="lot-starts-at-error">
              <FieldError>{errors.startsAt}</FieldError>
            </span>
          </div>
        )}
      </fieldset>

      <div>
        <Label htmlFor="lot-duration">Run for</Label>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <button
              key={d.hours}
              type="button"
              onClick={() => set("durationHours", d.hours)}
              aria-pressed={draft.durationHours === d.hours}
              className={cn(
                "h-9 rounded-full border px-4 text-[13px] transition-colors",
                draft.durationHours === d.hours
                  ? "border-gild-500/60 bg-gild-500/15 text-gild-100"
                  : "border-pewter/55 text-fog hover:border-gild-500/50",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex max-w-xs items-center gap-2">
          <Input
            id="lot-duration"
            type="number"
            min={1}
            max={720}
            value={draft.durationHours}
            onChange={(e) => set("durationHours", Number.parseInt(e.target.value, 10) || 0)}
            aria-invalid={Boolean(errors.durationHours)}
            aria-describedby={errors.durationHours ? "lot-duration-error" : undefined}
            className="tabular aria-[invalid=true]:border-ember-500/70"
          />
          <span className="text-sm text-ash">hours</span>
        </div>
        <span id="lot-duration-error">
          <FieldError>{errors.durationHours}</FieldError>
        </span>
      </div>

      <div className="rounded-xl border border-pewter/50 bg-white/[0.02] px-4 py-3.5">
        <h3 className="text-[11px] font-medium tracking-[0.12em] text-ash uppercase">
          Closing
        </h3>
        <p className="tabular mt-2 font-display text-lg text-linen">
          {draft.startMode === "now"
            ? `${describeHours(draft.durationHours)} after you submit`
            : endMs === null
              ? "—"
              : formatDateTime(new Date(endMs))}
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ash">
          {draft.type === "timed" ? (
            <>
              <strong className="text-fog">Soft close.</strong> A bid placed in the final{" "}
              {describeSeconds(antiSnipe.windowSeconds)} pushes the close out by another{" "}
              {describeSeconds(antiSnipe.extensionSeconds)}, and keeps doing so until a full
              window passes with nobody raising. Waiting until the last second stops being a
              tactic — everyone always gets the chance to answer.
            </>
          ) : (
            <>
              <strong className="text-fog">Worked from the rostrum.</strong> A live lot closes when
              the auctioneer knocks it down, not when the clock says so. The time above is when
              the house expects to reach it.
            </>
          )}
        </p>
      </div>
    </section>
  );
}

function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  body,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  body: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-xl border px-4 py-3.5 transition-colors",
        checked ? "border-gild-500/60 bg-gild-500/[0.08]" : "border-pewter/50 hover:border-pewter",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-1 size-3.5 shrink-0 accent-[var(--color-gild-400)]"
      />
      <span>
        <span className={cn("block text-sm font-medium", checked ? "text-gild-100" : "text-linen")}>
          {title}
        </span>
        <span className="mt-1 block text-[12.5px] leading-snug text-ash">{body}</span>
      </span>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 5 — Review                                                             */
/* -------------------------------------------------------------------------- */

function StepReview({
  draft,
  categories,
  startingCents,
  reserveCents,
  buyNowCents,
  startISO,
  onEdit,
}: {
  draft: Draft;
  categories: CategoryOption[];
  startingCents: number | null;
  reserveCents: number | null;
  buyNowCents: number | null;
  startISO: string | null;
  onEdit: (step: number) => void;
}) {
  const category = categories.find((c) => c.id === draft.categoryId);
  const condition = CONDITIONS.find((c) => c.value === draft.condition)!;
  const startMs = startISO ? new Date(startISO).getTime() : null;
  const endMs = startMs === null ? null : startMs + draft.durationHours * 3_600_000;

  return (
    <section aria-labelledby="step-review-heading" className="space-y-6">
      <header>
        <h2 id="step-review-heading" className="font-display text-2xl font-semibold text-linen">
          Last look
        </h2>
        <p className="mt-1.5 text-sm text-ash">
          Once a lot has a bid on it the terms are fixed — the room bid on these numbers, so they
          cannot move afterwards. Check them now.
        </p>
      </header>

      <ReviewBlock title="Item" onEdit={() => onEdit(1)}>
        <ReviewRow label="Title" value={draft.title || "—"} />
        <ReviewRow label="Department" value={category?.name ?? "Unassigned"} />
        <ReviewRow label="Condition" value={`${condition.label} — ${condition.note}`} />
        <ReviewRow label="Description" value={draft.description || "—"} multiline />
        {draft.provenance.trim() && (
          <ReviewRow label="Provenance" value={draft.provenance} multiline />
        )}
      </ReviewBlock>

      <ReviewBlock title="Images" onEdit={() => onEdit(2)}>
        <ReviewRow
          label="Count"
          value={`${draft.images.length} ${draft.images.length === 1 ? "image" : "images"}`}
        />
        {draft.images.length > 0 && (
          <ul className="col-span-full flex flex-wrap gap-2 pt-1">
            {draft.images.map((src, i) => (
              <li key={src} className="relative">
                <LotThumb src={src} alt={`Image ${i + 1}`} className="size-16" />
                {i === 0 && (
                  <span className="absolute -top-1.5 -left-1.5 rounded-full bg-gild-400 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-obsidian uppercase">
                    Hero
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </ReviewBlock>

      <ReviewBlock title="Pricing" onEdit={() => onEdit(3)}>
        <ReviewRow
          label="Opens at"
          value={startingCents === null ? "—" : formatCents(startingCents)}
        />
        <ReviewRow
          label="Reserve"
          value={reserveCents === null ? "None — it sells at whatever it makes" : formatCents(reserveCents)}
        />
        <ReviewRow
          label="Buy Now"
          value={buyNowCents === null ? "Not offered" : formatCents(buyNowCents)}
        />
        <ReviewRow
          label="First raise"
          value={
            startingCents === null
              ? "—"
              : `${formatCents(startingCents + incrementFor(startingCents))} (a ${formatCents(incrementFor(startingCents))} step)`
          }
        />
      </ReviewBlock>

      <ReviewBlock title="Schedule" onEdit={() => onEdit(4)}>
        <ReviewRow label="Type" value={draft.type === "timed" ? "Timed auction" : "Live sale lot"} />
        <ReviewRow
          label="Opens"
          value={
            draft.startMode === "now"
              ? "Immediately on submission"
              : startISO
                ? formatDateTime(new Date(startISO))
                : "—"
          }
        />
        <ReviewRow label="Runs for" value={describeHours(draft.durationHours)} />
        <ReviewRow
          label="Closes"
          value={
            draft.startMode === "now"
              ? `${describeHours(draft.durationHours)} after submission`
              : endMs === null
                ? "—"
                : formatDateTime(new Date(endMs))
          }
        />
      </ReviewBlock>
    </section>
  );
}

function ReviewBlock({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-pewter/45 bg-obsidian/60">
      <div className="flex items-center justify-between border-b border-pewter/35 px-5 py-3">
        <h3 className="font-display text-[15px] font-semibold text-linen">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="text-[13px] text-gild-200 underline decoration-gild-600/60 underline-offset-4 transition-colors hover:text-gild-100"
        >
          Edit
        </button>
      </div>
      <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        {children}
      </dl>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <>
      <dt className="text-[11px] tracking-[0.1em] text-ash uppercase sm:pt-0.5">{label}</dt>
      <dd
        className={cn("text-sm text-linen", multiline && "whitespace-pre-wrap")}
      >
        {value}
      </dd>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Live preview                                                                */
/* -------------------------------------------------------------------------- */

/** The lot as the catalogue will show it, rebuilt on every keystroke. */
function PreviewCard({
  draft,
  categories,
  startingCents,
  reserveCents,
  buyNowCents,
}: {
  draft: Draft;
  categories: CategoryOption[];
  startingCents: number | null;
  reserveCents: number | null;
  buyNowCents: number | null;
}) {
  const category = categories.find((c) => c.id === draft.categoryId);
  const condition = CONDITIONS.find((c) => c.value === draft.condition)!;

  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <p className="mb-3 text-[10.5px] font-medium tracking-[0.14em] text-ash uppercase">
        Catalogue preview
      </p>
      <div className="overflow-hidden rounded-2xl border border-pewter/45 bg-obsidian/70 backdrop-blur-xl">
        <div className="relative aspect-4/3 bg-slate-deep">
          {draft.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.images[0]} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center px-6 text-center text-[12px] text-ash">
              Add an image and it appears here
            </div>
          )}
          <div className="absolute top-3 left-3 flex gap-1.5">
            <Badge tone="gild">{draft.type === "timed" ? "Timed" : "Live"}</Badge>
            {reserveCents !== null && <Badge tone="neutral">Reserve</Badge>}
          </div>
        </div>
        <div className="px-4 py-4">
          <p className="text-[10.5px] tracking-[0.12em] text-ash uppercase">
            {category?.name ?? "Unassigned"} · {condition.label}
          </p>
          <h3 className="mt-2 font-display text-[17px] leading-snug font-semibold text-linen">
            {draft.title.trim() || "Your lot title will appear here"}
          </h3>
          <div className="mt-4 flex items-end justify-between gap-3 border-t border-pewter/35 pt-3.5">
            <div>
              <p className="text-[10.5px] tracking-[0.12em] text-ash uppercase">Opening bid</p>
              <p className="tabular mt-1 font-display text-xl font-semibold text-gild-200">
                {startingCents === null ? "—" : formatCents(startingCents)}
              </p>
            </div>
            {buyNowCents !== null && (
              <div className="text-right">
                <p className="text-[10.5px] tracking-[0.12em] text-ash uppercase">Buy now</p>
                <p className="tabular mt-1 font-display text-xl font-semibold text-linen">
                  {formatCents(buyNowCents)}
                </p>
              </div>
            )}
          </div>
          <p className="tabular mt-3 text-[12px] text-ash">
            Runs {describeHours(draft.durationHours)} · 0 bids
          </p>
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-ash">
        Reserves never appear as a number. Bidders see only that one exists, and whether it has
        been met.
      </p>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Formatting helpers                                                          */
/* -------------------------------------------------------------------------- */

/** `Date` -> the local-time string a `datetime-local` input expects. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

function formatDateTime(date: Date): string {
  return DATE_TIME_FORMAT.format(date);
}

function describeHours(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

function describeSeconds(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${seconds} seconds`;
}
