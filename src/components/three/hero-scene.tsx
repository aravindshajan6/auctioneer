"use client";

/* eslint-disable react-hooks/immutability --
   react-three-fiber's whole model is mutation: uniforms, matrices and
   transforms are written every frame from inside `useFrame`, and anime.js
   drives the same objects from outside React. The compiler's immutability
   rule cannot see that these values are never read during render, so it is
   switched off for this file and this file only. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  AdaptiveDpr,
  Environment,
  Lightformer,
  PerformanceMonitor,
  Preload,
} from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { animate, stagger, utils } from "animejs";
import "animejs/adapters/three";
import { commitChanges, getInstances } from "animejs/adapters/three";
import { publishStage, type DustInstances } from "./stage";

type Tier = "low" | "high";

/**
 * The lit saleroom, drawn rather than downloaded.
 *
 * Nothing here fetches an environment: the "HDRI" is four Lightformer quads
 * baked to a 256px cubemap and the light pool is a screen-space shader. The
 * only downloads are the catalogue plates themselves — the actual lots,
 * turning on a rack, which is the one thing on this page worth loading.
 */

/* -------------------------------------------------------------------------- */
/* Backdrop                                                                    */
/* -------------------------------------------------------------------------- */

const BACKDROP_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // A screen-space quad: bypass the camera entirely so the light pool is
    // resolution-independent and costs no depth work.
    gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
  }
`;

const BACKDROP_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uReveal;
  uniform float uScroll;
  uniform float uAspect;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    // The picture light hangs above the rostrum, so the pool falls from the
    // top edge and is squashed horizontally like a real spot on a floor.
    vec2 p = vUv - vec2(0.5, 1.02);
    p.x *= uAspect * 0.62;
    float pool = pow(smoothstep(1.05, 0.0, length(p)), 2.1);
    pool *= 0.84 + 0.16 * sin(uTime * 0.31);

    vec2 q = (vUv - vec2(0.84, 0.66)) * vec2(uAspect, 1.0);
    float halo = pow(smoothstep(0.62, 0.0, length(q)), 1.6);

    vec3 warm = vec3(0.49, 0.33, 0.10);
    vec3 cool = vec3(0.23, 0.17, 0.44);
    vec3 col = warm * pool + cool * halo * 0.34;
    // Haze along the floor so the gem sits in a volume instead of a void.
    col += vec3(0.05, 0.045, 0.075) * smoothstep(0.42, 0.0, vUv.y);
    col *= uReveal * (1.0 - 0.5 * uScroll);

    // --color-void, kept as the floor so the canvas never shows pure black.
    vec3 ground = vec3(0.0196, 0.0235, 0.0392);
    // Ordered-ish grain: 8-bit banding is extremely visible on near-black.
    float grain = (hash(vUv * 780.0 + fract(uTime)) - 0.5) * 0.016;
    gl_FragColor = vec4(ground + col + grain, 1.0);
  }
`;

/* -------------------------------------------------------------------------- */
/* Lot plates                                                                  */
/* -------------------------------------------------------------------------- */

export interface HeroLot {
  /** Public path to the catalogue plate, e.g. `/lots/....jpg`. */
  src: string;
  title: string;
}

interface Plate {
  texture: THREE.Texture;
  /** width / height, so a portrait canvas and a landscape one both fit. */
  aspect: number;
}

/** Longest edge of a framed lot, in scene units before the group is scaled. */
const MAX_H = 1.42;
const MAX_W = 1.92;
const RADIUS = 2.95;

/**
 * Load the catalogue plates, tolerating failures.
 *
 * drei's `useTexture` suspends and *throws* on a 404, which would take the
 * whole hero down for one missing file. The carousel would rather be short a
 * frame than absent, so failures are dropped and whatever loaded is used.
 */
function useLotPlates(sources: readonly string[]): Plate[] {
  const [plates, setPlates] = useState<Plate[]>([]);

  useEffect(() => {
    if (sources.length === 0) return;
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    const loaded: (Plate | undefined)[] = [];
    let pending = sources.length;

    const settle = () => {
      if (--pending === 0 && !cancelled) {
        setPlates(loaded.filter((p): p is Plate => Boolean(p)));
      }
    };

    sources.forEach((src, index) => {
      loader.load(
        src,
        (texture) => {
          if (cancelled) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          const image = texture.image as { width: number; height: number };
          loaded[index] = {
            texture,
            aspect: image.width / Math.max(1, image.height),
          };
          settle();
        },
        undefined,
        settle,
      );
    });

    return () => {
      cancelled = true;
    };
  }, [sources]);

  // Textures are GPU allocations; React will not free them for us.
  useEffect(
    () => () => {
      for (const plate of plates) plate.texture.dispose();
    },
    [plates],
  );

  return plates;
}

/** Fit a plate inside the frame box without distorting the photograph. */
function plateSize(aspect: number): [number, number] {
  let h = MAX_H;
  let w = h * aspect;
  if (w > MAX_W) {
    w = MAX_W;
    h = w / aspect;
  }
  return [w, h];
}

/* -------------------------------------------------------------------------- */
/* Scene                                                                       */
/* -------------------------------------------------------------------------- */

function Saleroom({
  lots,
  tier,
  reduced,
}: {
  lots: readonly HeroLot[];
  tier: Tier;
  reduced: boolean;
}) {
  const carousel = useRef<THREE.Group>(null);
  const frames = useRef<(THREE.Group | null)[]>([]);
  const dust = useRef<THREE.InstancedMesh>(null);
  const idleStarted = useRef(false);

  const { viewport } = useThree();
  const invalidate = useThree((state) => state.invalidate);

  const sources = useMemo(() => lots.map((lot) => lot.src), [lots]);
  const plates = useLotPlates(sources);

  /* A reduced-motion visitor gets `frameloop="demand"`, where a frame is only
     drawn when something asks for one. The plates arrive asynchronously and
     well after the settling burst has finished, so without this the rack is
     built, posed and lit — and never painted. */
  useEffect(() => {
    if (plates.length > 0) invalidate();
  }, [plates.length, invalidate]);

  /* Geometry counts are fixed at mount. If a mid-scroll quality drop rebuilt
     the instanced mesh, every mote would be handed a fresh anime.js proxy and
     the running drift would be tweening objects nobody renders. Only the
     material's sampling and the post chain react to the live tier. */
  const [dustCount] = useState(() => (tier === "high" ? 110 : 45));

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uReveal: { value: 1 },
      uScroll: { value: 0 },
      uAspect: { value: 1 },
    }),
    [],
  );

  /* Composition. The rack is a turntable with real width, not a single object,
     so it has to be placed by its RADIUS rather than its centre: park the
     centre at 0.2 of the viewport and the near frames swing back across the
     headline every revolution. On a wide screen the whole circle is pushed
     clear of the text; on a phone it centres, shrinks and lifts instead. */
  const wide = viewport.width / viewport.height > 1.2;
  const rackScale = viewport.height * (wide ? 0.15 : 0.062);
  const rackRadius = RADIUS * rackScale;
  // Leave the left edge of the circle just clear of centre, where the copy ends.
  const offsetX = wide ? Math.max(viewport.width * 0.26, rackRadius + viewport.width * 0.06) : 0;
  // On a phone there is no room beside the copy, so the rack goes above it —
  // small, high and quiet, atmosphere rather than a second focal point.
  const offsetY = wide ? -0.05 : viewport.height * 0.37;

  useLayoutEffect(() => {
    const mesh = dust.current;
    const rack = carousel.current;
    if (!mesh || !rack) return;

    // Do not publish a stage with an empty rack. The hero claims the first
    // stage it is offered and ignores every later one, so an early publish
    // would hand it a timeline with no frames to animate — and the real
    // frames, posed at scale 0 by the branch below, would never be revealed.
    if (lots.length > 0 && plates.length === 0) return;

    const proxies = getInstances(mesh).filter(
      (instance): instance is NonNullable<typeof instance> => instance !== null,
    ) as DustInstances;

    // Motes hang in a shell around the rack rather than a box, so nothing
    // clusters in the corners where the vignette would eat it anyway.
    const restY: number[] = [];
    proxies.forEach((mote, i) => {
      const angle =
        (i / proxies.length) * Math.PI * 2 + utils.random(-0.4, 0.4, 3);
      const radius = utils.random(1.6, 5.2, 3);
      const y = utils.random(-2.6, 2.8, 3);
      mote.x = Math.cos(angle) * radius;
      mote.y = y;
      mote.z = Math.sin(angle) * radius * 0.55 - 0.4;
      mote.scale = reduced ? 1 : 0;
      restY.push(y);
    });
    commitChanges(mesh);

    const mounted = frames.current.filter((f): f is THREE.Group => f !== null);

    if (!reduced) {
      // Pre-entrance pose. The hero timeline tweens out of exactly these.
      for (const frame of mounted) frame.scale.setScalar(0);
      rack.rotation.y = THREE.MathUtils.degToRad(-38);
      uniforms.uReveal.value = 0;
    }

    const startIdle = () => {
      if (idleStarted.current || reduced) return;
      idleStarted.current = true;
      // One slow revolution. The lots are the spectacle; the turntable should
      // not be. Linear, because an eased loop visibly hitches at the seam.
      animate(rack, {
        rotateY: 360,
        duration: 64000,
        ease: "linear",
        loop: true,
      });
      animate(proxies, {
        y: (_target, index) =>
          (restY[index ?? 0] ?? 0) + utils.random(-0.55, 0.55, 3),
        duration: () => utils.random(6000, 11000),
        delay: stagger(24, { from: "random" }),
        ease: "inOutSine",
        alternate: true,
        loop: true,
      });
    };

    const unpublish = publishStage({
      carousel: rack,
      frames: mounted,
      dust: proxies,
      reveal: uniforms.uReveal,
      startIdle,
    });

    // If the DOM half never claims the stage — a hero-side failure, or a
    // visitor who navigated in with JS mid-flight — the scene must not sit
    // invisible. Reveal it on its own after a beat.
    const rescue = window.setTimeout(() => {
      if (idleStarted.current || reduced) return;
      animate(uniforms.uReveal, { value: 1, duration: 900, ease: "out(2)" });
      animate(rack, { rotateY: 0, duration: 1200, ease: "out(3)" });
      animate(mounted, {
        scale: 1,
        duration: 800,
        delay: stagger(60),
        ease: "out(4)",
      });
      animate(proxies, { scale: 1, duration: 700, delay: stagger(4) });
      startIdle();
    }, 2600);

    return () => {
      window.clearTimeout(rescue);
      unpublish();
    };
    // `plates.length` is the dependency that matters: the frames only exist
    // once the photographs have loaded.
  }, [reduced, uniforms, dustCount, plates.length, lots.length]);

  const worldPos = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, delta) => {
    // Runs on demand-mode renders too, so the reduced-motion still frame gets
    // a correctly proportioned light pool.
    uniforms.uAspect.value = state.size.width / state.size.height;

    // Depth cue: a lot on the far side of the turn is dim, the one facing the
    // room is fully lit. Without this the rack reads as a flat ring of
    // stickers rather than objects standing in a space.
    for (const frame of frames.current) {
      if (!frame) continue;
      frame.getWorldPosition(worldPos);
      const near = THREE.MathUtils.clamp(
        (worldPos.z - (offsetY * 0 - RADIUS * rackScale)) /
          (2 * RADIUS * rackScale),
        0,
        1,
      );
      // Squaring this drops the shoulders of the arc into near-black and the
      // rack reads as one picture floating alone; a gentler curve keeps the
      // lots either side of the front legible as objects turning away.
      const opacity = 0.22 + 0.78 * Math.pow(near, 1.45);
      frame.traverse((child) => {
        const mesh = child as THREE.Mesh;
        const material = mesh.material as THREE.Material | undefined;
        if (material && "opacity" in material) material.opacity = opacity;
      });
    }

    if (reduced) return;
    uniforms.uTime.value += delta;
    if (dust.current) dust.current.rotation.y += delta * 0.018;
  });

  return (
    <>
      <mesh frustumCulled={false} renderOrder={-100}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={BACKDROP_VERT}
          fragmentShader={BACKDROP_FRAG}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <group position={[offsetX, offsetY, 0]} rotation={[0.11, 0, 0]} scale={rackScale}>
        <group ref={carousel}>
          {plates.map((plate, index) => {
            const angle = (index / plates.length) * Math.PI * 2;
            const [w, h] = plateSize(plate.aspect);
            return (
              <group
                key={lots[index]?.src ?? index}
                ref={(node) => {
                  frames.current[index] = node;
                }}
                position={[
                  Math.sin(angle) * RADIUS,
                  0,
                  Math.cos(angle) * RADIUS,
                ]}
                rotation={[0, angle, 0]}
              >
                {/* The gilt: a slightly larger plate behind the picture, which
                    is all a frame is once the light is doing the work. */}
                <mesh position={[0, 0, -0.012]}>
                  <planeGeometry args={[w + 0.13, h + 0.13]} />
                  <meshStandardMaterial
                    color="#d9ab3e"
                    metalness={1}
                    roughness={0.28}
                    emissive="#7d541c"
                    emissiveIntensity={0.35}
                    transparent
                    side={THREE.DoubleSide}
                  />
                </mesh>
                {/* Unlit, so a photograph reads as the photograph rather than
                    as a surface the rig happens to be pointing at. */}
                <mesh>
                  <planeGeometry args={[w, h]} />
                  <meshBasicMaterial
                    map={plate.texture}
                    toneMapped={false}
                    transparent
                    side={THREE.DoubleSide}
                  />
                </mesh>
              </group>
            );
          })}
        </group>
      </group>

      <instancedMesh
        ref={dust}
        args={[undefined, undefined, dustCount]}
        frustumCulled={false}
        position={[offsetX, offsetY, -1.1]}
      >
        <octahedronGeometry args={[0.016, 0]} />
        <meshStandardMaterial
          color="#f0da96"
          emissive="#d9ab3e"
          emissiveIntensity={1.1}
          roughness={0.35}
          metalness={0.9}
          toneMapped={false}
        />
      </instancedMesh>

      {/* Local lighting rig. No preset, no CDN, no network. */}
      <Environment resolution={256}>
        <Lightformer
          intensity={5}
          position={[0, 5, -7]}
          scale={[10, 5, 1]}
          color="#fff6e0"
        />
        <Lightformer
          intensity={2.2}
          position={[-6, 1, 3]}
          scale={[5, 7, 1]}
          color="#9fc6ff"
        />
        <Lightformer
          form="ring"
          intensity={4}
          position={[4.5, 2.5, 3]}
          scale={3.2}
          color="#ffd9a0"
        />
        <Lightformer
          intensity={1.4}
          position={[0, -5, 2]}
          scale={[8, 3, 1]}
          color="#c3a8ff"
        />
      </Environment>
      <ambientLight intensity={0.5} />
      <pointLight
        position={[2.4, 3.2, 2.6]}
        intensity={22}
        color="#ffe6b0"
        distance={14}
        decay={2}
      />
    </>
  );
}

/**
 * With `frameloop="demand"` nothing renders until something asks. The
 * transmission material and the baked environment both need a couple of
 * frames to settle, so a reduced-motion visitor gets a short burst of renders
 * and then complete stillness — not a black rectangle.
 */
function SettleStillFrame() {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const timers = [0, 80, 200, 420, 700, 1100, 1700].map((ms) =>
      window.setTimeout(invalidate, ms),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [invalidate]);
  return null;
}

/* -------------------------------------------------------------------------- */
/* Canvas                                                                      */
/* -------------------------------------------------------------------------- */

/** A lost or absent WebGL context must degrade to the CSS-only hero rather
 *  than throwing inside the R3F tree. Safe to probe during render: this
 *  module is only ever loaded with `ssr: false`. */
function hasWebGL(): boolean {
  try {
    if (!window.WebGLRenderingContext) return false;
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    // Browsers cap live contexts at around sixteen; hand this one straight
    // back so the probe never costs the real canvas its slot.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

export default function HeroScene({ lots }: { lots: readonly HeroLot[] }) {
  const [supported] = useState(hasWebGL);
  // Safe to read synchronously: this module is only ever loaded with
  // `ssr: false`, so there is no server render to disagree with.
  const [reduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [tier, setTier] = useState<Tier>(() => {
    if (typeof window === "undefined") return "low";
    const cores = navigator.hardwareConcurrency ?? 4;
    const small = window.innerWidth < 900;
    return small || cores <= 4 ? "low" : "high";
  });

  if (!supported) return null;

  return (
    <Canvas
      dpr={[1, tier === "high" ? 2 : 1.5]}
      gl={{
        antialias: false,
        alpha: true,
        powerPreference: "high-performance",
      }}
      camera={{ position: [0, 0.15, 6.4], fov: 34 }}
      frameloop={reduced ? "demand" : "always"}
      style={{ pointerEvents: "none" }}
    >
      {/* Drop to the cheap scene the moment frames start slipping, rather than
          shipping a beautiful hero that stutters on an integrated GPU. */}
      {/* One-way only: promoting back to `high` after a decline just produces
          a scene that oscillates between two qualities under load. */}
      <PerformanceMonitor
        bounds={() => [45, 60]}
        onDecline={() => setTier("low")}
      >
        <Saleroom lots={lots} tier={tier} reduced={reduced} />
      </PerformanceMonitor>

      {tier === "high" && !reduced && (
        <EffectComposer multisampling={0}>
          <Bloom
            intensity={0.75}
            luminanceThreshold={0.55}
            luminanceSmoothing={0.3}
            mipmapBlur
          />
          <Vignette darkness={0.62} offset={0.22} />
        </EffectComposer>
      )}

      <AdaptiveDpr pixelated />
      <Preload all />
      {reduced && <SettleStillFrame />}
    </Canvas>
  );
}
