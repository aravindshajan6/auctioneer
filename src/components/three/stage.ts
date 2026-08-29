import type { Object3D } from "three";
import type { getInstances } from "animejs/adapters/three";

/** Per-instance proxies for the dust field, with the `null` slots filtered out. */
export type DustInstances = NonNullable<ReturnType<typeof getInstances>[number]>[];

/**
 * Everything in the WebGL scene that the hero's entrance timeline is allowed
 * to touch.
 *
 * The canvas is code-split and mounts client-side only, so the DOM half of the
 * hero cannot simply `useRef` into it. The scene publishes its animatable
 * targets here instead, and the hero picks them up — which keeps a single
 * anime.js timeline in charge of the words, the buttons and the carousel
 * rather than three loops that only look synchronised.
 */
export interface HeroStage {
  /** The carousel group. Entrance turns it into place; idle keeps it moving. */
  carousel: Object3D;
  /**
   * Each framed lot, in carousel order, so the entrance can bring them in one
   * after another rather than revealing the whole rack at once.
   */
  frames: Object3D[];
  dust: DustInstances;
  /** Backdrop shader progress, 0 dark to 1 fully lit. */
  reveal: { value: number };
  /** Handed back so the scene, not the hero, owns its idle loops. */
  startIdle: () => void;
}

let current: HeroStage | null = null;
const listeners = new Set<(stage: HeroStage) => void>();

export function publishStage(stage: HeroStage): () => void {
  current = stage;
  for (const listener of listeners) listener(stage);
  return () => {
    if (current === stage) current = null;
  };
}

/**
 * Fires immediately when the scene is already mounted, otherwise on publish.
 * Callers must still cope with never being called — WebGL may be unavailable.
 */
export function subscribeStage(listener: (stage: HeroStage) => void): () => void {
  listeners.add(listener);
  if (current) listener(current);
  return () => {
    listeners.delete(listener);
  };
}
