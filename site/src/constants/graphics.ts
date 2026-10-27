// Path data for the SVG illustrations.

import { scenePath } from "../styles/classes";
import type { SvgPath } from "../types";

export const BRAND_MARK_PATHS: SvgPath[] = [
  { d: "M32 11v42" },
  { d: "M14 32h17M33 32h17" },
  { d: "M19 48c6-12 6-20 0-32M45 16c-6 12-6 20 0 32" },
];

/** Where each fog lane drifts across the hero scene, and how fast. */
export const HERO_FOG_LANES = [
  "top-[26%] h-37.5 animate-fog-drift opacity-70",
  "top-[54%] h-27.5 animate-fog-drift-slow opacity-44",
];

export const HERO_BRIDGE_PATHS: SvgPath[] = [
  { d: "M-40 426C220 340 430 322 646 352s384 8 594-104" },
  { d: "M-40 472C230 382 438 366 650 392s386 10 590-92" },
  { d: "M352 328v224M814 282v268" },
  { d: "M352 328C466 404 682 412 814 282" },
  { d: "M352 328C394 420 458 478 548 526" },
  { d: "M814 282C760 404 680 478 548 526" },
];

export const HERO_SKYLINE_PATHS: SvgPath[] = [
  {
    d: "M0 232h146v-42h70v-80h54v122h88v-64h58v64h92v-102h52v102h76v-170h42v170h86v-84h64v84h90v-58h76v58h126",
  },
  { className: `${scenePath} stroke-[rgba(8,11,13,0.28)]`, d: "M722 232 759 72l38 160" },
  {
    className: `${scenePath} stroke-[rgba(232,109,78,0.32)]`,
    d: "M956 232l34-130 34 130M990 104v128M948 145h84M936 185h108",
  },
];

/** Layers of the wall, top to bottom, labelled in the hero scene. */
export const HERO_WALL_LAYERS = ["admission", "gate", "ledger"];

const deck = `${scenePath} stroke-current stroke-5`;
const tower = `${scenePath} stroke-current stroke-4`;
const cable = `${scenePath} stroke-current stroke-2 opacity-70`;

export const FOOTER_BRIDGE_PATHS: SvgPath[] = [
  { className: deck, d: "M-60 414C222 330 468 322 704 368s442 10 756-116" },
  { className: `${deck} opacity-62`, d: "M-60 474C230 388 476 376 708 414s444 18 752-98" },
  { className: tower, d: "M348 286v250M1000 220v316" },
  { className: tower, d: "M320 344h56M970 286h60M320 424h56M970 390h60" },
  { className: cable, d: "M348 286C500 414 786 430 1000 220" },
  { className: cable, d: "M348 286C412 426 522 514 682 552" },
  { className: cable, d: "M1000 220C910 404 794 506 682 552" },
];

export const FOOTER_SKYLINE_PATHS: SvgPath[] = [
  {
    d: "M0 270h120v-48h72v-60h54v108h94v-78h62v78h130v-126h46v126h92v-72h70v72h98v-108h46v108h104v-54h92v54h130",
  },
  { className: `${scenePath} stroke-[rgba(8,11,13,0.34)]`, d: "M770 270l42-182 42 182M812 96v174" },
  {
    className: `${scenePath} stroke-[rgba(232,109,78,0.5)] stroke-3`,
    d: "M1086 270l36-132 36 132M1122 142v128M1080 184h84M1068 224h108",
  },
];
