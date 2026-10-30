---
name: Floodwall
description: A clear, inspectable engineering surface for infrastructure change control.
colors:
  ink: "#171717"
  paper: "#ffffff"
  canvas: "#f2f2f2"
  surface: "#f5f5f5"
  muted: "#606060"
  line: "#e5e5e5"
  accent: "#171717"
  accent-hover: "#353535"
  panel: "#171717"
  panel-text: "#ffffff"
  panel-dim: "#b8b8b8"
  panel-line: "#3a3a3a"
  admit: "#287247"
  defer: "#85600f"
  reject: "#8a2533"
  bridge: "#b8392e"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, sans-serif"
    fontSize: "clamp(36px, 3.5vw, 50px)"
    fontWeight: 350
    lineHeight: 1.06
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Geist, ui-sans-serif, sans-serif"
    fontSize: "clamp(32px, 3.3vw, 48px)"
    fontWeight: 350
    lineHeight: 1.08
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Geist, ui-sans-serif, sans-serif"
    fontSize: "24px"
    fontWeight: 550
    lineHeight: 1.2
  body:
    fontFamily: "Geist, ui-sans-serif, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist, ui-sans-serif, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
  mono-label:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.08em"
    textTransform: uppercase
rounded:
  control: "0px"
  surface: "0px"
  slide: "0px"
spacing:
  deck-gutter: "clamp(12px, 2.2vw, 32px)"
  slide-gap: "24px"
  section-inset: "16px phone, 24px tablet, 32px desktop (1100px and wider)"
  cell: "24px desktop and 16px phone side padding; 16px in ledger rows"
  desktop-slide-height: "min(780px, calc(100svh - var(--header-offset) - 48px))"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.panel-text}"
    rounded: "{rounded.surface}"
    padding: "0 24px"
    height: "52px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-header:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel-text}"
    rounded: "{rounded.surface}"
    padding: "0 20px"
    height: "44px"
  nav-link:
    textColor: "{colors.muted}"
    height: "44px"
  nav-active:
    textColor: "{colors.ink}"
  slide-surface:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.slide}"
  policy-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "0px"
---

# Design System: Floodwall

## Overview

**Creative North Star: "The Clear Decision Boundary"**

Floodwall is an engineering surface arranged as a small deck of white slides on a neutral gray plane. The masthead rests directly on that plane; each page section becomes its own square, finely outlined sheet, with a measured gutter between sheets. Open navigation and direct black actions keep the frame calm while the sections hold complex infrastructure policy.

The animated decision boundary remains the signature: a dense, irregular intake resolves through a gate, a linked recording step, and checked production output. The illustration's green, amber, and wine red are reserved for verdicts and recorded outcomes; the footer's bridge vermilion marks only the current diagram stage. On wide screens, the hero and each of the five following sections read as six slides in a presentation deck. On phones and tablets, those same sheets grow naturally into one continuous scroll.

**Key Characteristics:**
- White framed section sheets and footer against a neutral-gray canvas plane.
- Near-black actions and headings; shared drawing-title bands and fine gray rules organize the evidence.
- Geist for interface and explanatory text; Geist Mono for code and diagram zone labels.
- Outcome colors communicate admit, defer, or reject states only.

## Colors

The palette is neutral by default: black carries action and emphasis, gray defines the page structure, and color appears only where it communicates a decision.

### Primary
- **Near Black** (#171717): Main action fill, headings, active navigation, selection, and policy code.
- **Action Hover Gray** (#353535): Hover fill for primary actions.

### Neutral
- **White Sheet** (#ffffff): Drawing sheets and evidence cells, plus text on black actions.
- **Neutral Gray Plane** (#f2f2f2): Background around the white slide sheets and beneath the open masthead navigation.
- **Muted Gray** (#606060): Supporting copy and inactive navigation.
- **Rule Gray** (#e5e5e5): Borders and dividers on light surfaces.
- **Panel Gray** (#b8b8b8): Reserved secondary text for inverse surfaces.
- **Panel Rule** (#3a3a3a): Reserved divider for inverse surfaces.

### Tertiary
- **Admit Green** (#287247): Admitted verdicts and successful production state.
- **Defer Amber** (#85600f): Held or deferred verdicts.
- **Reject Wine** (#8a2533): Rejected verdicts. Deeper than the bridge vermilion so a rejection never reads as a selection.

**The Outcome-Only Color Rule.** Use green, amber, and red to encode real verdict or outcome states. Do not use them as general decoration or as alternate action colors.

The user-requested footer print is the illustration exception: the Golden Gate Bridge carries vermilion ink, while its skyline, hills and water use the neutral page palette. The same vermilion (`--bridge`) marks the hero diagram's current stage (its station outline, callout and breadcrumb label), whether the cycle reached it or the reader hovered or pinned it; it is a stage mark, not a verdict, and it introduces no red interface actions or decoration elsewhere.

### Dark appearance and browser chrome

Dark mode keeps the same drawing geometry on a #111111 canvas with #1b1b1b sheets, #f2f2f2 ink, #b2b2b2 supporting text and #393939 rules. Diagram strokes, platform faces, checked green cartons and amber held intents have their own matching semantic tokens. Primary actions reverse to pale fills with dark text. The footer print becomes a restrained negative engraving, retaining its warm red bridge, framing and independent fog/boat motion.

Light values are primitives (`--light-paper`, `--light-ink`, `--light-muted`, `--light-line`) that the light theme and the always-light waitlist cell both reference. The first visit follows the system color scheme. The footer's keyboard-accessible sun/moon control remembers an explicit light/dark choice in local storage; blocked storage still permits a choice for the visit. Theme setup runs before the app renders. The root background, body, masthead and `theme-color` metadata all use the active canvas color, so supporting browser chrome can match the background surface. A theme change preserves paused animation frames and in-flight diagram state, and suspends transitions for one frame so every colour swaps at once rather than smearing.

The build prerenders the page: `vite build --ssr src/entry-server.tsx` renders the app once, and `site/scripts/prerender.mjs` writes that HTML into `docs/index.html`'s `#root`, which `main.tsx` then hydrates. Every heading, paragraph, stat and link is in the HTML before any script runs; only the diagram, the waitlist form and the motion need JavaScript, and the `noscript` note now says just that, linking the waitlist form through the same `WAITLIST_FORM_URL` the section uses (the Vite plugin fills it in). The prerendered footer playback and theme controls stay disabled until the app hydrates, so they never look usable without JavaScript. Browser-only values read during render (media queries, the `?hero=` variant, the theme) render one agreed server value and update after hydration, so hydration never mismatches. The hero counts are prerendered as their final values; a pre-paint flag hides them until CountUp takes them over, and CSS shows them after 2.5s if the bundle never runs. The built page carries a Content-Security-Policy meta tag (GitHub Pages sets no headers): scripts from its own origin, its inline scripts by build-time hash, and Tally; frames from Tally only. Tally's `embed.js` strips any iframe `sandbox` to size the form, so the policy is what bounds it. The `/hairline` diagram scripts sit outside the hashed bundle, so their URLs carry a content hash of that folder.

Section links keep their own history positions. Each history entry carries an id, and each entry's position is kept in session storage as the section under the header line plus the distance scrolled into it (the 50 most recent, written when the page is hidden or left), so a reload returns to the exact position even when content above that section changes height, and Back/Forward after a reload still restore each entry's place. After a reload the position is held against late layout (the diagram sizing itself, the waitlist form resizing) for up to 2s or until the reader scrolls, clicks or types. A fresh visit starts at the top or at its fragment, and a link, history step or hash change made before the restore lands cancels it.

## Typography

**Display Font:** Geist Variable (with ui-sans-serif, sans-serif fallbacks)
**Body Font:** Geist Variable (with ui-sans-serif, sans-serif fallbacks)
**Label/Mono Font:** Geist Mono Variable (with ui-monospace, SFMono-Regular, Menlo, Consolas fallbacks)

**Character:** Self-hosted Geist Variable keeps display and body text in one crisp, compact voice. Geist Mono is reserved for code, hashes, and technical labels that benefit from a visibly fixed-width rhythm.

### Hierarchy
- **Display** (weight 350 with 650 emphasis, clamp(36px, 3.5vw, 50px), line-height 1.06, letter-spacing -0.04em): Hero heading; uses a smaller 34–44px clamp on narrow viewports.
- **Headline** (weight 350 with 650 emphasis, clamp(32px, 3.3vw, 48px), line-height 1.08, letter-spacing -0.04em): Major section and footer headings.
- **Title** (weight 550, 24px, line-height 1.2): Stage and release titles; crate facts use 18px values.
- **Body** (weight 400, 16px, line-height 1.55): Explanatory copy, with measure commonly capped near 46ch.
- **Label** (weight 500, 14–15px): Navigation and interface actions.
- **Mono** (weight 400, 12px; 11px at 600px and below): Policy code. Recorded verdicts use weight 450 at 11px, and hero figures weight 500.
- **Mono label** (weight 500, 11px, uppercase, 0.08em tracking): Section kickers, panel headers, footer group labels, title-block terms and diagram callouts share this one label style. Callouts are sized in screen pixels, not drawing units: 11px on the wide drawing (capped where its header row would collide, about 10px at 1100px) and 10px in the portrait column. Hero figures use Geist Mono with tabular, slashed-zero digits; whole numbers count up once on first view. Font sizes use the `--text-*` and `--label-size` tokens wherever one matches; headings take `--display-md` from `.display-heading`.

**The One Interface Voice Rule.** Use Geist for headings, prose, navigation, and actions; use Geist Mono only for code-like data and technical diagram labels.

**Staccato headings.** Each major heading pairs a light 350-weight premise with one semantically emphasized 650-weight conclusion. Keep the sentence readable as one heading and let balanced wrapping adapt across viewports. Subsection titles retain their 550 weight. Public brand text is always ERP•AI; domain names and URLs keep their actual spelling.

## Layout

The page is a deck centered at up to 1440px wide, with a 12–32px outer gutter. Its transparent main grid has a 24px gap and no top inset, so Home meets the navigation bottom at rest; each section is a white, 1px-ruled sheet with square corners. The hero and supporting sheets use 16–32px equal insets; the masthead content is capped at 1280px. On desktop (1100px and wider), the hero has a minimum height of `min(780px, 100svh - header - 48px)`: observed slide heights are 780px at 1440×1000, 772px at 1440×900, 672px at 1280×800, 592px at 1280×720, and 652px at 1100×780. The Model, Roadmap and Waitlist surfaces cap their minimum height at 480px, Gate at 560px, and Ledger at 640px, all constrained by the same viewport budget. Each uses one drawing frame with a shared title band and fully ruled content cells. Policy and record fields occupy 60% of the body beside the explanation/facts cell, separated by a 1px rule. Model titles use 24px with 16px copy; Roadmap versions use 32px above 24px release titles. The desktop hero gives the diagram a larger column and a height allowance based on the slide minus 256px. Its equal 32px desktop insets, 24px column gap and ruled diagram title block keep the heading, controls and crate/queue facts together inside the slide without changing diagram geometry. At 1099px and below, sections return to natural height and continuous scrolling so longer content is never cropped. The masthead remains on the gray plane, 80px tall at wide sizes and 128px when links wrap below 850px. The footer closes the deck as a matching white outlined sheet.

**The One Section per Sheet Rule.** Keep every major section and the footer on its own outlined white surface, with the gray canvas visible between sheets.

Every section link aligns its surface top directly beneath the sticky header, with no canvas gap or strip of the previous section above it. Initial URL fragments use the same alignment. Direct navigation commits the clicked section while the indicator glides; manual scrolling tracks the section crossing a 1px band immediately below the header, retaining the last active section through inter-sheet gaps. Initial alignment, font/viewport changes, and reduced-motion preference place the indicator without travel.

**The Ruled Sequence Rule.** Keep related stages, releases and evidence inside one shared drawing frame, divided by fine rules. Use verdict colors for decisions and white paper for the evidence surface.

## Elevation & Depth

On first view each supporting section's inner drawing fades in and rises 8px over 560ms, and its ruled cells follow with a 60ms stagger; sections already on screen where the load lands (measured after a fragment jump or a reload's restored position), and reduced motion, skip it. The section itself never moves, so navigation alignment is unaffected. The interface uses no box shadows. The background plane separates the white slide sheets; thin rules organize their drawing cells, while the isometric illustration carries its own volume. The sticky navigation blends into the canvas at rest and remains borderless when sticky.

## Shapes

Each section and the footer share square corners and a 1px gray outline. The page plane stays visible as a consistent 24px inter-slide gap. The hero and four supporting sections use equal 32px desktop, 24px tablet and 16px phone insets. Buttons, secondary surfaces and the native release hit target use square corners. The navigation remains open text on the canvas, with only the moving 2px active underline. The isometric illustration carries its own rounded platform and station geometry.

## Components

### Iconography
Interface icons use the official `@hugeicons/react` renderer with named imports from `@hugeicons/core-free-icons`, a shared 1.5 stroke and `currentColor`. Sizes follow their roles: 16px stage chevrons, 14px verdict marks, 16px ledger checks and header arrow, and 20px playback/action icons. Stage names retain 12px text on desktop and 11px on mobile in a wrapping ordered list; separators stay attached to their following label. The current stage has 650 weight and a neutral background covering its complete label box with 6px vertical and 8px horizontal padding (in forced-colours mode, a `CanvasText` outline instead); the row's own 4px side padding puts the stage text on the same 12px edge as the title block and legend; chevrons stay outside the highlight, with its bold width reserved to prevent reflow. Playback is an icon-only 44px button in its own column, with an action tooltip and accessible name. There is no separate stage readout. Decorative icons are hidden from assistive technology. Keep the authored brand mark and isometric illustration separate from interface iconography.

The favicon set follows erpai.studio's sizes and is generated from SVG sources by `site/scripts/generate-favicons.sh` (macOS `sips` renders; Node packs the ICO with PNG frames). Tab icons are the brand mark in one ink colour, as in the header, footer and share card (`#171717` light, `#f2f2f2` dark): an adaptive `/favicon.svg`, fixed light and dark SVGs, and 16/32/48/64px transparent PNGs, each linked per `prefers-color-scheme`. Search, launcher and legacy consumers share one opaque square ink tile (`site/artwork/favicon/floodwall-tile.svg`) with an all-white mark inset to survive a circular crop: PNGs at 96/192/256px (linked), 512px (manifest) and 16–256px (the frames of a seven-frame `/favicon.ico`), and apple-touch icons at 152/167px with `/apple-touch-icon.png` at 180px. Nothing is generated that is not linked or packed. Safari's pinned-tab mask is a flat black outline. Favicons live in `site/public/favicon/`, not `icons/`, which a common global `Icon?` git-ignore rule would swallow.

The viewport scrollbar stays native in size, so macOS overlay and Windows/Linux classic behavior are preserved: `scrollbar-width: thin` with a `--scroll-thumb` thumb on the canvas track (`#8a8a8a` on `#f2f2f2`, 3.1:1; `#737373` on `#111111`, 4:1). The theme's `color-scheme` selects native dark scrollbar chrome, and forced-colors mode returns both properties to `auto`.

The 1200×630 share card (`/og/floodwall.png`) is one light sheet on the canvas: a brand band with the "Policy gates for agent-driven DevOps" label in a right-hand cell ruled on its left, the hero heading and a one-line lead beside a callout-free still of the hero diagram, and a ruled facts row (language, licence, shipped version, dependencies, tests, site). `site/artwork/og/card.html` lays it out with the site's own stylesheet; `site/scripts/generate-og-image.sh <dev-url>` captures the reduced-motion diagram still and the card with agent-browser, filling the facts from Cargo.toml. The page's description, canonical link, Open Graph and Twitter card tags and a schema.org JSON-LD graph (ERP•AI organization, website, web page, share image and the `SoftwareSourceCode` crate, whose version, licence, repository, description, keywords and minimum Rust version come from Cargo.toml) are injected at build time from `site/structured-data.mjs`; the build fails if `index.html`'s title drifts from it. `site.webmanifest` names the site and its 192/512px icons. The Organization node carries ERP•AI's stable 512px search icon as its logo, and the 160-character description is tested to fit a search snippet. The sitemap omits `lastmod` rather than carrying a hand-kept date that would go stale. `site/public/404.html` is a small `noindex` sheet in the same tokens for unknown paths, so hosts that serve it answer 404 instead of the home page.

### Buttons
- **Shape:** Square corners (0px), with a transparent border and no shadow.
- **Primary:** Near-black fill with white 14px medium text; 52px height and 24px horizontal padding.
- **Header action:** Near-black compact fill; 44px height and 20px horizontal padding.
- **Hover / Active / Focus:** Hover shifts to dark gray; active returns to black. Keyboard focus uses a visible 2px near-black outline with a 5px offset.
- **Secondary:** Plain text link with a small arrow; hover underlines it or shifts it to the primary ink color.

### Cards / Containers
- **Slide surface:** Each main section and the footer is a separate white sheet with a 0px radius, 1px gray border, no shadow, and the same frame spacing. Desktop compositions stay within 780px, with height based on content density; below 1100px they grow naturally with their content.
- **Policy evidence:** White cells integrated into the drawing frame, with ruled header, verdict rows and implementation footer.
- **Ledger:** Facts and records share one framed sheet; record fields have vertical dividers and the digest has its own footer band.
- **Internal Padding:** Supporting frames use equal 16/24/32px outer insets. Cells use 24px desktop and 16px mobile side padding; ledger record fields use 16px, which keeps the 80px verdict cell whole.

### Navigation
- **Style:** Medium-weight Geist links rest directly on the gray canvas, with 28px gaps on wide screens, 15px type, and 44px-high targets.
- **Default / Hover / Active:** Inactive links are muted gray; hover darkens the text. The current section uses near-black text and one shared 2px underline flush with the masthead bottom edge, retaining `aria-current` semantics. The line glides to the active label and matches its text width over 260ms with cubic-bezier(.25,1,.5,1); CSS transform transitions retarget during rapid navigation. Clicking selects the destination immediately and holds it through intervening sections; arrival or manual wheel, touch, scrollbar/pointer, or scroll-key input returns tracking to the section observer. Initial placement and responsive/font alignment are immediate, and reduced motion removes the travel.
- **Scrolled / Responsive:** The sticky header stays directly on the canvas with no added border. Below 850px the links take their own row at their natural widths with 4px minimum gaps and 14px text; under enlarged user text spacing (WCAG 1.4.12) they wrap rather than overflow, and SiteHeader publishes the header's measured height as `--header-offset` for scroll padding and the slide height. The brand and action stay together above them; at 380px and below, the decorative action arrow and the Home link (the logo also goes home) hide, the logo drops to 20px and the action padding to 10px, so the brand and action keep one row. Below 850px the header action uses 12px text with 14px side padding. Viewport overscroll follows the primary input, as on erpai.studio: `html` and `body` keep native `auto` behavior, so touch and non-hovering pens retain bounce and pull-to-refresh, while `(hover: hover) and (pointer: fine)` sets `overscroll-behavior: none` on both axes. Width never selects input behavior. Hover styling follows the same rule: every `:hover` sits under `(hover: hover) and (pointer: fine)`, so a tap never leaves a hover state behind. Motion shares `--ease-out` (`cubic-bezier(.25,1,.5,1)`) and `--motion-fast` 160ms, `--motion-move` 260ms and `--motion-reveal` 560ms (cells at three quarters).
- **Focus:** Keep a visible keyboard outline, inset 4px: the links fill the header's height, so an outside ring would lose its top edge at the top of the viewport. In forced-colours mode the active underline is drawn in `CanvasText`, since backgrounds are dropped.

### Policy Panel
The policy sheet has a shared title band, explanation cell, and white evidence table with a compact metadata header, three ruled verdict rows and an implementation footer. Code stays near-black, supporting text is gray, and each verdict retains its semantic color and Hugeicons mark. All wording is preserved.

### Supporting drawing sheets
Model, Gate, Ledger, Roadmap and Waitlist share a ruled title band: a 28px tab only as wide as its small uppercase Geist Mono label (16px side padding, 12px at 600px and below), ruled on its right and bottom against the drawing frame, with the full-width Geist heading 20px below it (16px on phones). Model uses four fully bounded stage cells. Gate joins explanation and policy evidence with a vertical rule. Ledger adds individually ruled checked facts and three-field record rows. Roadmap uses version bands above release descriptions. Desktop minimum-height caps follow content density: 480px for Model/Roadmap, 560px for Gate and 640px for Ledger, within the viewport slide budget.

Above 900px, Gate, Ledger and Waitlist bodies split 40/60 beneath the single-column title band. Roadmap versions, titles and descriptions share subgrid rows so a two-line title never changes the description baseline beside it. Stage/release title-to-copy spacing is 12px; titles use 1.2 line-height and explanatory stage/release copy shares the 1.55 body rhythm. Paragraphs use pretty wrapping to avoid isolated final words. Evidence verdict line-height remains unitless.

Below 900px, evidence columns stack and Model/Roadmap become two-column grids. At 600px and below, headers, stages and releases form a single-column reading sequence. Mobile ledger records keep an unbroken verdict in an 80px cell, with agent and intent stacked in the adjacent cell. No content is removed or abbreviated.

### Footer drawing sheet

The footer uses the same equal 32/24/16px foreground insets and one continuous inner drawing frame. Its brand and supporting copy share the left 40% of the title band; the headline occupies the right 60%. The desktop link grid sits below the headline, leaving the bridge clear at left. The user's charcoal intaglio/block-print panorama, with its vermilion bridge, is a full-width background behind this foreground grid. It extends to the footer's outer edges and retains its natural 2164:727 ratio without clipping, distortion or a separate image-band border. Each link list shares one even white backing with feathered edges (12px blur and 12/20px bleed). Individual links are transparent, avoiding hard word-sized patches while keeping the skyline visible between groups. A responsive 144–280px lower clearance keeps the panorama visible above the opaque credit row; desktop footer height stays within 780px. Below 900px links span the foreground width; at 600px and below, the title band stacks as logo, headline and copy, Explore and Crate share two columns, Related projects occupies its own row, and credits stack. Existing copy and destinations are preserved, including the linked ERP•AI project credit. Artwork provenance, prompts and the PNG master live in `site/artwork/`.

### Footer atmosphere

The footer print is layered (`srcset` widths 720–2164px for the waterfront; the fog and boat sprites get their `href`s only within 600px of view, since SVG `<image>` cannot lazy-load): a boatless engraved waterfront, three independently drifting translucent fog banks, and three sailboat sprites with short reflections. Fog uses 64/73/82-second linear passes at different heights and opacities; boats follow 44/52/62-second forward routes with gentle vertical movement and edge fades. All moving properties are transform and opacity. The fuzzy cloud shapes come from a transparent image asset rather than geometric gradient blobs.

Dark mode reverses only the waterfront and boat ink. Fog retains a pale silver body, with a static 8px blur, 55% vertical scale and 10/14/6% layer opacity. This creates thin, translucent coastal mist rather than inverted dark clouds. Light-mode fog keeps its original height, shading and opacity. The moving parent groups retain their existing paths and playback clocks.

The credits start with a content-width copyright cell ("© Floodwall.", with no year: a build-time year would go stale in the committed `docs/` and fail CI's sync check each January), followed by the project credit and adjacent 48px icon-only playback and theme cells using Hugeicons. On phones the copyright and two controls share the first row; the project credit spans a second bordered row. The credit reads "An ERP•AI project · Built with Proto", and the footer wordmark carries the same ® as the header and share card. Playback has accessible Pause/Resume names and tooltips (the diagram's too); the theme control exposes its Dark mode pressed state and the destination theme in its tooltip. Pausing preserves the exact frame and resuming continues it. IntersectionObserver and document visibility suspend the scene when it cannot be seen; initial and live reduced motion retain still clouds and boats and disable playback. Foreground links share a soft paper veil per group and remain fully operable. Layer masters and generation prompts are recorded in `site/artwork/footer-motion.md`.

### Decision Diagram
The isometric flow is the signature illustration: one machined slab with chamfered (cut, never rounded) corners. A squared intake bay with straight lane dividers steps through a 45° shoulder into a straight channel through admission and the three-lane scheduler. Intents queue at the sluice gate, which rules on each one. The hold arm leaves the channel right at the gate's queue, toward the viewer, and ends in the round release button: the gate sends a deferred intent down into the bay, where it waits until a person presses release and then returns to the gate, which now admits it. Past the gate the channel runs under the ledger arch into the production yard, where a low pad with a crisp chamfered edge marks "dry ground". Painted floor lanes with square-cut flow chevrons mark the routes: the hold lane dropping straight from the gate's queue into the bay; a separate release lane from the bay back to the gate, which lights in the release tone while a released batch is moving; and the main lane on the channel axis from the gate under the ledger arch onto dry ground. A hairline guide marks the axis up to the gate. The hold and release lanes sit 11 units either side of the arm and bay centreline; the release lane turns 90° onto the centre of the channel's near half to rejoin the gate's queue. Every lane is closed by square stop bars, and the pad carries row guides for its three carton rows with a back stop at the far end. A deferred intent leaves the gate's queue down the hold lane into the bay (amber), the shutter staying down for it; a rejected intent sinks at the gate (red); admitted intents pass the gate, are stamped by the ledger head, morph into checked green cartons and slide onto the pad in three lanes. A released intent climbs the release lane, waits for the shutter to lift, passes the gate, and is stamped like the rest. Each arrival advances its pad lane one place and the farthest carton fades off the far end. Cartons are sharp chamfered boxes with a clean lid carrying one bold check, drawn along the screen axes so it reads upright from either camera. The ledger chain rides on the arch beam and slides one receipt per stamp. Recording uses the ink stroke, never an outcome colour.

Every route is one eased curve through its waypoints, so a box never stops at a corner, and a box rides up over each plate's lip instead of cutting through it. Solids are depth-sorted every frame from their world boxes, so moving work passes correctly under the gate and arch. Upright Geist Mono callouts, numbered in stage order and named as in the breadcrumb (Intents with the sub-label Flood, through Production with Dry ground), sit on hairline leaders that start at the midpoint of a station edge, never a corner. On desktop the main-line leaders rise as flags to one shared header row; the scheduler takes an elbow leader off its near edge, and Hold drops below its arm. The current stage's station, callout and breadcrumb label take the bridge vermilion. Phones use a straight-on portrait camera, so the channel runs vertically down the screen, with the callouts in one aligned right-hand column. The native release hit target remains keyboard accessible.

### Diagram title block and stage motion
Queue state, crate facts, stage progress, playback and the explanatory legend share one drawing-style caption with a 1px outer frame. The upper band contains the hold count and three crate facts; the shared 11px mono labels (10px with .06em tracking at 500px and below) sit above 18px tabular values. A horizontal rule separates the breadcrumb row, with a dedicated 48px playback cell and vertical divider. The legend occupies a quiet final band with a top rule. No gaps separate these bands.

On desktop, the intro and illustration occupy the upper row and this title block spans both columns beneath them, creating one shared baseline. The figure inherits the hero's column and row tracks through CSS subgrid. Hero content uses equal insets on all four sides: 32px on desktop, 24px on tablet, and 16px at 600px and below. Below 1100px, the block stays attached to its illustration, with the hold cell spanning a row above the three facts; at 500px and below the fact columns widen the middle cell (0.9/1.2/0.9) so "Dependencies" fits. Breadcrumbs wrap between complete items while playback fills its own cell. The single-column diagram, caption and intro share the same left and right edges; the former phone diagram bleed and tablet width cap are removed. The separate hero location line and old statistics footer remain removed.

The shared two-column hero and full-width drawing-block baseline also apply from 761–1099px, without the desktop slide-height constraint. This keeps stage controls and the legend from being compressed into a narrow diagram column. At 760px and below, the intro comes first and the diagram and its attached block follow, so the visual order matches the reading and focus order. The diagram chooses its layout from its own rendered width: below 580px it draws the portrait camera with a right-hand label column (also from 761–1099px, where the diagram column is narrow), and a container query reserves that aspect ratio before it mounts.

Each breadcrumb stage is a button that pins its station in the diagram (highlighted solids and callout) until it is pressed again; hovering the drawing previews another station and leaving returns to the pin. One persistent background rectangle moves between breadcrumb labels with a transform-only 260ms `cubic-bezier(.25,1,.5,1)` transition, driven by the illustration's stage events. It fits the complete padded label and travels in both axes when the list wraps. Pause freezes an in-flight transition and keeps the breadcrumb on its stage, while hovering the drawing still previews a station; resume continues it. Hover styling applies only on hover-capable fine pointers, so a tap never leaves a latched underline, and hover never takes the vermilion off the current or pinned stage. Initial placement, font/viewport reflow and reduced motion align immediately.

### Accessibility and lifecycle

A first-focusable skip link moves keyboard focus into the main content. Fragment navigation, including Back/Forward during a smooth scroll, aligns the target below the masthead and restores section tracking. Ambient queue counts remain readable without repeated live announcements; only requested releases announce progress and delivery. Completed release jobs relinquish their cards to the production stack and are retired. Failed diagram setup removes its SVG and media listener, leaves controls unavailable, and displays a recovery message. The alternate stack concept starts only from its Play control; the continuous processing line and footer retain their Pause/Resume controls. Both compositions respect initial and live reduced-motion preferences.

## Do's and Don'ts

### Do:
- **Do** frame major sections and the footer as separate square white sheets on the neutral gray plane.
- **Do** keep surfaces, controls and image corners square, and the sticky masthead borderless.
- **Do** use fine rules and open columns to organize ordered evidence.
- **Do** keep navigation open, comfortably spaced, and clearly stateful without filled tabs.
- **Do** preserve a high-contrast focus outline on links and controls.
- **Do** reserve outcome colors for actual decisions and production state.

### Don't:
- **Don't** add shadows or translucent cards; the system's depth comes from the sheet spacing, contrast, and rules.
- **Don't** reintroduce orange as a brand accent or general-purpose action color.
- **Don't** introduce a second display typeface or use monospace for explanatory prose.
