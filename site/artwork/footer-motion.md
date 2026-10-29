# Footer atmosphere and boat layers

Created with the built-in image-generation tool on 2026-10-29, using the approved footer print as the edit/style reference.

| Asset | Purpose | Dimensions | Shipping size |
| --- | --- | --- | --- |
| `../public/footer-water.webp` | Bridge, skyline and engraved water with stationary boats removed | 2164 × 727 | 522 KB |
| `../public/footer-fog.webp` | One transparent fuzzy fog bank, reused for three drifting layers | 1400 × 295 | 123 KB |
| `../public/footer-boat.webp` | One transparent engraved sailboat, reused at three depth scales | 340 × 458 | 56 KB |

The full-resolution generated masters are `footer-water-master.png`, `footer-fog-master.png` and `footer-boat-master.png` beside this document. Shipping assets preserve alpha; transparent margins were trimmed from the sprite assets and they were encoded as WebP at quality 0.9. The earlier still print and its master remain available.

## Motion contract

- Fog: three independent linear passes lasting 64, 73 and 82 seconds, with staggered phases and different heights/opacities. Each bank exits the frame completely before wrapping.
- Boats: three forward sailing routes lasting 44, 52 and 62 seconds; short edge fades hide route resets, and a small vertical drift suggests water movement. The boatless background prevents stationary duplicates.
- All animated properties are transform and opacity. No per-frame JavaScript runs.
- An icon-only Hugeicons playback cell controls all six layers. Pause preserves the exact frame; resume continues it.
- IntersectionObserver and document visibility stop offscreen/background motion. Initial and live reduced-motion preferences retain a static scene and disable playback.
- Full bridge/skyline framing, foreground links and page copy remain unchanged.

## Boatless background prompt

Use case: precise-object-edit. Edit this exact San Francisco intaglio print. Remove ONLY the three sailboats and their immediate dark reflections from the water (small boat left of center, medium boat at center, large boat near right). Fill those small areas with the same fine horizontal engraved water lines and white cutout water. The boats will be re-added as independent moving layers in code. Preserve EVERYTHING else pixel-aligned as closely as possible: unchanged bridge position/size/red color, towers, every skyline building, hills, shoreline, engraving style, transparent sky and ragged transparent bottom silhouette. Keep the identical very wide panoramic framing and aspect ratio, target canvas 2164 by 727. Do not add clouds, boats, new objects, text, frame, gradients or background; preserve transparency. Absolutely no other compositional or palette change.

## Fog sprite prompt

Use case: stylized-concept. Asset type: a single transparent fog-cloud sprite for layering over a charcoal engraved San Francisco skyline on a pure white website. Draw one long, low drifting coastal fog bank, wide horizontal composition approximately 4:1. Organic overlapping soft cloud wisps with irregular billowing top edge, a smooth thinning lower veil and frayed translucent edges. Pearl white mist with very subtle neutral silver-gray internal depth #d8d8d8; predominantly light white, no blue or warm colors. Soft fuzzy volume, elegant atmospheric fog, barely perceptible fine stippled texture that complements an intaglio print without harsh outlines. Fully transparent around and between the fading wisps, including all four corners; no opaque rectangle or solid sky, no buildings, no bridge, no boats, no scenery, no text or borders. The fog needs to remain discernible against a white background through its softly shaded pale-gray body, while still veiling a black-and-white skyline underneath. This is one isolated fog bank, not multiple panels, not a grid, not a photograph of a whole sky.

## Boat sprite prompt

Use case: background-extraction. Asset type: isolated sprite for animation. Using the attached intaglio San Francisco print as the style reference, extract/recreate ONLY the large sailboat near the lower right as one clean transparent cutout. Keep the same three-quarter side view, triangular white sails with delicate charcoal engraved hatching, slender dark mast, dark carved hull, and a very short soft neutral-gray reflection directly below the hull. One boat only, all of it fully visible, centered with modest transparent margin. No water rectangle, no surrounding sea lines, no city, no bridge, no clouds, no sky, no border, no text. Pure white #ffffff, charcoal #171717 and neutral gray only. The silhouette including rigging must be crisp and the background must be genuinely transparent. This will be scaled to three different sizes over the original engraved water, so the cutout needs to blend naturally into that print. No color, no red accents, no drop shadow.
