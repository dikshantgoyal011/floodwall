import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { Icon } from "./Icon";
import { StageBreadcrumb } from "./StageBreadcrumb";
import { CountUp } from "./CountUp";

export type FigureName = "processing-line" | "control-stack";

/** Below this stage width (px) the processing line draws its portrait layout; hero.css mirrors it. */
const NARROW_FIGURE = 580;
type Tour = { stop(): void };
type HoldState = { count: number; available: number; busy: boolean; paused: boolean; completed: number; point: [number, number]; frame: { x: number; y: number; width: number; height: number } };
type HoldSnapshot = { held: number; completed: number };
type FigureHandle = { snapshot?(): HoldSnapshot; release?(): void; set(value: number): void; destroy(): void; play?(): void; setPaused?(paused: boolean): void; pin?(stage: string | null): void };
type Figure = {
  name: FigureName;
  means: string;
  range: [number, number, number];
  tour: ([number, number] | null)[];
  mount(context: { stage: HTMLElement; svg: SVGSVGElement; narrow?: boolean; resume?: HoldSnapshot; onStageChange?(stage: string): void; onHoldChange?(state: HoldState): void }, value: number): FigureHandle;
};

declare global {
  interface Window {
    floodwallFigures: Partial<Record<FigureName, Figure>>;
    HL: {
      inject(root: Document): void;
      mk(tag: "svg", attributes: Record<string, string>, parent: HTMLElement): SVGSVGElement;
      setReducedMotion(reduce: boolean): void;
      tour(stage: HTMLElement, stops: Figure["tour"], onStop: (index: number) => void): Tour;
    };
  }
}

const STAGES = {
  "processing-line": ["Intents", "Admission", "Scheduler", "Gate", "Ledger", "Production"],
  "control-stack": ["Admission", "Gate", "Ledger"],
};

export function IsometricDiagram({ variant, stats }: { variant: FigureName; stats: readonly { value: string | number; label: string }[] }) {
  const stageRef = useRef<HTMLDivElement>(null);
  // The figure's layout follows its own rendered width (see processing-line.js); the prerendered
  // HTML and the hydrating render assume the wide layout, then this measures before first paint.
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setNarrow(stage.getBoundingClientRect().width < NARROW_FIGURE);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  const playRef = useRef<() => void>(() => {});
  const releaseRef = useRef<() => void>(() => {});
  const [hold, setHold] = useState<HoldState | null>(null);
  const [releaseAnnouncement, setReleaseAnnouncement] = useState("");
  const pauseRef = useRef<(paused: boolean) => void>(() => {});
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const continuous = variant === "processing-line";
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [activeStage, setActiveStage] = useState("");
  const [pinned, setPinned] = useState<string | null>(null);
  const pinRef = useRef<(stage: string | null) => void>(() => {});
  const pinnedRef = useRef<string | null>(null);
  // Crossing NARROW_FIGURE rebuilds the figure for the other layout; this carries its hold queue,
  // pinned stage and announcements over, so a resize or rotation loses nothing.
  const carriedRef = useRef<{ variant: FigureName; hold?: HoldSnapshot } | null>(null);
  const stages = STAGES[variant];
  const playbackLabel = reducedMotion ? "Animation disabled for reduced motion"
    : continuous ? paused ? "Resume diagram animation" : "Pause diagram animation" : "Play diagram animation";
  const playbackTooltip = reducedMotion ? "Animation disabled for reduced motion"
    : continuous ? paused ? "Resume" : "Pause" : "Play";

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    const carried = carriedRef.current?.variant === variant ? carriedRef.current : null;
    carriedRef.current = { variant };
    setReady(false);
    setFailed(false);
    if (!carried) {
      setActiveStage("");
      setPinned(null);
      pinnedRef.current = null;
      setHold(null);
      setReleaseAnnouncement("");
    }

    async function mount() {
      await import(/* @vite-ignore */ `/hairline/${variant}.js?v=${__HAIRLINE_VERSION__}`);
      if (disposed || !stageRef.current) return;
      const figure = window.floodwallFigures[variant];
      if (!figure) throw new Error("Figure did not register");
      const stops = figure.tour;
      const stage = stageRef.current;
      const { HL } = window;
      HL.inject(document);
      const media = matchMedia("(prefers-reduced-motion: reduce)");
      let tour: Tour | undefined;
      let handle: FigureHandle | undefined;
      let svg: SVGSVGElement | undefined;
      let observer: IntersectionObserver | undefined;
      let visible = false;
      let started = false;
      let completed = carried?.hold?.completed ?? 0;
      cleanup = () => {
        carriedRef.current = { variant, hold: handle?.snapshot?.() };
        observer?.disconnect();
        media.removeEventListener("change", syncMotion);
        tour?.stop();
        handle?.destroy();
        pauseRef.current = () => {};
        releaseRef.current = () => {};
        pinRef.current = () => {};
        svg?.remove();
        stage.style.removeProperty("aspect-ratio");
        playRef.current = () => {};
      };
      const syncMotion = () => {
        HL.setReducedMotion(media.matches);
        if (media.matches) {
          tour?.stop();
        }
        handle?.setPaused?.(media.matches || pausedRef.current);
        setReducedMotion(media.matches);
        if (continuous && visible && !started) play();
      };
      syncMotion();
      media.addEventListener("change", syncMotion);
      svg = HL.mk("svg", { viewBox: "0 0 400 320", "aria-hidden": "true" }, stage);
      handle = figure.mount({ stage, svg, narrow, resume: carried?.hold,
        onStageChange: stage => { if (!disposed) setActiveStage(stage); },
        onHoldChange: state => {
          if (disposed) return;
          setHold(state);
          if (state.completed > completed) setReleaseAnnouncement(`${state.completed} held intents recorded and delivered to production.`);
          completed = state.completed;
        } }, figure.range[1]);
      handle.setPaused?.(media.matches || pausedRef.current);
      releaseRef.current = () => handle?.release?.();
      pinRef.current = stage => handle?.pin?.(stage);
      if (pinnedRef.current) handle.pin?.(pinnedRef.current);
      pauseRef.current = (paused) => handle?.setPaused?.(media.matches || paused);
      function play() {
        tour?.stop();
        if (media.matches) return;
        started = true;
        if (handle?.play) handle.play();
        else tour = HL.tour(stage, stops, (index) => {
          if (index === stops.length - 1) tour?.stop();
        });
      }
      playRef.current = play;
      // The kernel pauses its shared frame loop offscreen and settles reduced motion.
      observer = new IntersectionObserver(([entry]) => {
        const entering = entry.isIntersecting && !visible;
        visible = entry.isIntersecting;
        // The finite stack tour has no pause handle, so it starts only on request. The continuous
        // line restarts at its first stage on every entry, unless the reader paused it.
        if (continuous && entering && !pausedRef.current) play();
      }, { threshold: 0.5 });
      observer.observe(stage);
      setReady(true);
    }
    mount().catch(() => {
      cleanup();
      if (!disposed) { setHold(null); setFailed(true); }
    });
    return () => { disposed = true; cleanup(); };
  }, [variant, narrow]);

  return (
    <figure className="line-diagram">
      <div className="diagram-scene">
      <div
        ref={stageRef}
        className="isometric-stage"
        data-hairline={variant}
        role="img"
        aria-label={variant === "processing-line"
          ? "A flood of intents passes through admission and the scheduler to the policy gate. The gate sends deferred intents to hold, where they wait until a person presses release and then pass the gate. Admitted intents continue through the ledger to dry ground: production. Checked, recorded changes accumulate there as green boxes."
          : "Exploded isometric control plane. Admission, policy, and ledger layers separate to reveal how they fit together."}
      />
      {continuous && hold && <button type="button" className="hold-release-control"
        style={{ left: `${(hold.point[0] - hold.frame.x) / hold.frame.width * 100}%`, top: `${(hold.point[1] - hold.frame.y) / hold.frame.height * 100}%` }}
        // Busy, paused and empty are passing states: aria-disabled keeps focus on the button through them.
        disabled={!ready || failed}
        aria-disabled={hold.busy || hold.paused || hold.available === 0 || undefined}
        aria-label={`Release ${hold.available} held intents`} title={`Press to release ${hold.available} held intents`}
        onClick={() => {
          if (hold.busy || hold.paused || hold.available === 0) return;
          setReleaseAnnouncement(`Releasing ${hold.available} held intents through the ledger to production.`);
          releaseRef.current();
        }} /> }
      </div>
      <figcaption className="diagram-drawing-block">
      {failed && <p className="diagram-error" role="alert">The diagram could not load. Reload the page to try again.</p>}
      <div role="group" aria-label="Current crate and queue state">
        <dl className="diagram-title-block" data-has-hold={continuous}>
          {continuous && <div className="diagram-hold-block">
            <dt>On hold</dt>
            <dd>
              <span>{hold?.count ?? 0}</span>
              <span className="diagram-hold-instruction">{hold?.busy ? "Recording and delivering" : hold && hold.completed > 0 ? `${hold.completed} released to production` : hold?.count === 0 ? "Incoming intents continue" : !hold ? "Deferred intents wait here" : hold.paused ? "Resume to release held intents" : `Release ${hold.available} held intents`}</span>
            </dd>
          </div>}
          {stats.map(({ value, label }) => <div key={label}><dt>{label}</dt><dd className="diagram-stat"><CountUp value={value} /></dd></div>)}
        </dl>
      </div>
      <p className="sr-only" role="status">{releaseAnnouncement}</p>
      <div className="diagram-caption">
        <StageBreadcrumb stages={stages} activeStage={pinned ?? activeStage} paused={paused || reducedMotion}
          pinned={pinned ?? undefined} onSelect={continuous && ready && !failed ? stage => {
            const next = pinned === stage ? null : stage;
            setPinned(next);
            pinnedRef.current = next;
            pinRef.current(next);
          } : undefined} />
          <button type="button" className="diagram-motion-control" disabled={!ready || failed || reducedMotion} onClick={() => {
            if (continuous) { const next = !pausedRef.current; pausedRef.current = next; setPaused(next); pauseRef.current(next); }
            else playRef.current();
          }} aria-label={playbackLabel} title={playbackTooltip}>
            <Icon icon={continuous && !paused ? PauseIcon : PlayIcon} size={20} />
          </button>
      </div>
      {variant === "processing-line" && <p className="diagram-note">Hold: deferred intents wait for human release or expiry. The ledger records every verdict and outcome. Green boxes show checked, recorded changes in production.</p>}
      </figcaption>
    </figure>
  );
}
