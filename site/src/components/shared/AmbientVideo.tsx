import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { playVideo } from "../../helpers/video";

// Start the fade-out this long before the clip ends. It covers the 500ms CSS
// opacity fade plus the ~250ms between `timeupdate` events.
const FADE_OUT_LEAD_SECONDS = 0.8;

type AmbientVideoProps = {
  src: string;
  className: string;
  poster?: string;
  /** Fade out at the end of each pass and back in on restart, instead of a hard loop cut. */
  fadeLoop?: boolean;
};

/**
 * Decorative, muted background video. Nothing downloads until it first
 * scrolls near the viewport, and it is paused whenever it is off screen, so
 * it costs nothing while the visitor is reading elsewhere on the page.
 */
export function AmbientVideo({ src, className, poster, fadeLoop = false }: AmbientVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const inViewRef = useRef(false);
  const [visible, setVisible] = useState(!fadeLoop);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        inViewRef.current = entry.isIntersecting;
        if (entry.isIntersecting) playVideo(video);
        else video.pause();
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  const fadeHandlers = fadeLoop
    ? {
        onPlaying: () => setVisible(true),
        onTimeUpdate: ({ currentTarget: video }: SyntheticEvent<HTMLVideoElement>) => {
          if (video.duration - video.currentTime <= FADE_OUT_LEAD_SECONDS) setVisible(false);
        },
        onEnded: ({ currentTarget: video }: SyntheticEvent<HTMLVideoElement>) => {
          video.currentTime = 0;
          if (inViewRef.current) playVideo(video);
        },
      }
    : {};

  return (
    <video
      ref={videoRef}
      className={className}
      data-visible={visible}
      src={src}
      poster={poster}
      muted
      playsInline
      loop={!fadeLoop}
      preload="none"
      aria-hidden="true"
      {...fadeHandlers}
    />
  );
}
