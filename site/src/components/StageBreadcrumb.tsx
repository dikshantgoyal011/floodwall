import { useCallback, useLayoutEffect, useRef } from "react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./Icon";

type Props = { stages: readonly string[]; activeStage: string; paused: boolean; pinned?: string; onSelect?(stage: string): void };

export function StageBreadcrumb({ stages, activeStage, paused, pinned, onSelect }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const positionRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const positionHighlight = useCallback((animate: boolean) => {
    const root = rootRef.current;
    const highlight = highlightRef.current;
    const label = root?.querySelector<HTMLElement>('[aria-current="step"] .diagram-stage-label');
    if (!root || !highlight) return;
    if (!label) {
      highlight.style.visibility = "hidden";
      positionRef.current = null;
      return;
    }
    const frame = root.getBoundingClientRect(), box = label.getBoundingClientRect();
    const next = { x: box.left - frame.left, y: box.top - frame.top, width: box.width, height: box.height };
    const previous = positionRef.current;
    if (previous && Math.abs(next.x - previous.x) < .1 && Math.abs(next.y - previous.y) < .1
      && Math.abs(next.width - previous.width) < .1 && Math.abs(next.height - previous.height) < .1) return;
    if (!previous || !animate) highlight.style.transition = "none";
    highlight.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.width}, ${next.height})`;
    highlight.style.visibility = "visible";
    if (!previous || !animate) {
      highlight.getBoundingClientRect();
      highlight.style.removeProperty("transition");
    }
    positionRef.current = next;
  }, []);

  useLayoutEffect(() => positionHighlight(true), [activeStage, positionHighlight]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => positionHighlight(false));
    observer.observe(root);
    root.querySelectorAll(".diagram-stage-label").forEach(label => observer.observe(label));
    return () => observer.disconnect();
  }, [stages, positionHighlight]);
  useLayoutEffect(() => {
    // Freeze even an in-flight glide at the same instant as the diagram.
    highlightRef.current?.getAnimations().forEach(animation => {
      if (paused) {
        const time = animation.currentTime;
        animation.pause();
        // Resolve the pending pause synchronously instead of advancing one last frame.
        if (time !== null) animation.currentTime = time;
      } else animation.play();
    });
  }, [paused]);

  return <div className="diagram-breadcrumb" ref={rootRef}>
    <span className="diagram-stage-highlight" ref={highlightRef} aria-hidden="true" />
    <ol className="diagram-stages" aria-label="Processing stages">
      {stages.map((stage, index) => <li key={stage} aria-current={activeStage === stage.toLowerCase() ? "step" : undefined}>
        {index > 0 && <Icon icon={ArrowRight01Icon} size={16} />}
        {onSelect
          ? <button type="button" className="diagram-stage-label" data-label={stage} aria-pressed={pinned === stage.toLowerCase()}
            title={pinned === stage.toLowerCase() ? "Unpin this stage" : `Show ${stage} in the diagram`}
            onClick={() => onSelect(stage.toLowerCase())}><span>{stage}</span></button>
          : <span className="diagram-stage-label" data-label={stage}><span>{stage}</span></span>}
      </li>)}
    </ol>
  </div>;
}
