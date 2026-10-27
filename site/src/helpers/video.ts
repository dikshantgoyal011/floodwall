export function playVideo(video: HTMLVideoElement) {
  // Rejects if the browser blocks autoplay; the illustrated scene behind stays.
  video.play().catch(() => {});
}
