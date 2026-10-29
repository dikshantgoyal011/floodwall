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
  reject: "#b8392e"
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
    lineHeight: 1.06
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
    lineHeight: 1.65
  label:
    fontFamily: "Geist, ui-sans-serif, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 500
rounded:
  control: "0px"
  surface: "0px"
  slide: "0px"
spacing:
  gutter: "clamp(20px, 4vw, 64px)"
  deck-gutter: "clamp(12px, 2.2vw, 32px)"
  slide-gap: "24px"
  slide-inset: "0px"
  section-space: "clamp(32px, 4vw, 64px)"
  desktop-slide-height: "min(780px, calc(100svh - var(--header-height) - 48px))"
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

The animated decision boundary remains the signature: a dense, irregular intake resolves through a gate, a linked recording step, and checked production output. The illustration's green, amber, and red are reserved for verdicts and recorded outcomes. On wide screens, the hero and each of the four following sections read as five slides in a presentation deck. On phones and tablets, those same sheets grow naturally into one continuous scroll.

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
- **Reject Red** (#b8392e): Rejected verdicts.

**The Outcome-Only Color Rule.** Use green, amber, and red to encode real verdict or outcome states. Do not use them as general decoration or as alternate action colors.

The user-requested footer print is the illustration exception: the Golden Gate Bridge carries vermilion ink, while its skyline, hills and water use the neutral page palette. This does not introduce red interface actions or decoration elsewhere.

### Dark appearance and browser chrome

Dark mode keeps the same drawing geometry on a #111111 canvas with #1b1b1b sheets, #f2f2f2 ink, #b2b2b2 supporting text and #393939 rules. Diagram strokes, platform faces, checked green cartons and amber held intents have their own matching semantic tokens. Primary actions reverse to pale fills with dark text. The footer print becomes a restrained negative engraving, retaining its warm red bridge, framing and independent fog/boat motion.

The first visit follows the system color scheme. The footer's keyboard-accessible sun/moon control remembers an explicit light/dark choice in local storage; blocked storage still permits a choice for the visit. Theme setup runs before the app renders. The root background, body, masthead and `theme-color` metadata all use the active canvas color, so supporting browser chrome can match the background surface. A theme change preserves paused animation frames and in-flight diagram state.

## Typography

**Display Font:** Geist Variable (with ui-sans-serif, sans-serif fallbacks)
**Body Font:** Geist Variable (with ui-sans-serif, sans-serif fallbacks)
**Label/Mono Font:** Geist Mono Variable (with ui-monospace, SFMono-Regular, Menlo, Consolas fallbacks)

**Character:** Self-hosted Geist Variable keeps display and body text in one crisp, compact voice. Geist Mono is reserved for code, hashes, and technical labels that benefit from a visibly fixed-width rhythm.

### Hierarchy
- **Display** (weight 350 with 650 emphasis, clamp(36px, 3.5vw, 50px), line-height 1.06, letter-spacing -0.04em): Hero heading; uses a smaller 34–44px clamp on narrow viewports.
- **Headline** (weight 350 with 650 emphasis, clamp(32px, 3.3vw, 48px), line-height 1.06, letter-spacing -0.04em): Major section and footer headings.
- **Title** (weight 550, 24px, line-height 1.2): Stage and release titles; crate facts use 18px values.
- **Body** (weight 400, 16px, line-height 1.65): Explanatory copy, with measure commonly capped near 46ch.
- **Label** (weight 500, 14–15px): Navigation and interface actions.
- **Mono** (weight 500, 12px): Diagram labels, code, and recorded values.

**The One Interface Voice Rule.** Use Geist for headings, prose, navigation, and actions; use Geist Mono only for code-like data and technical diagram labels.

**Staccato headings.** Each major heading pairs a light 350-weight premise with one semantically emphasized 650-weight conclusion. Keep the sentence readable as one heading and let balanced wrapping adapt across viewports. Subsection titles retain their 550 weight. Public brand text is always ERP•AI; domain names and URLs keep their actual spelling.

## Layout

The page is a deck centered at up to 1440px wide, with a 12–32px outer gutter. Its transparent main grid has a 24px gap and no top inset, so Home meets the navigation bottom at rest; each section is a white, 1px-ruled sheet with square corners. The hero and supporting sheets use 16–32px equal insets; the masthead content is capped at 1280px. On desktop (1100px and wider), the hero has a minimum height of `min(780px, 100svh - header - 48px)`: observed slide heights are 780px at 1440×1000, 772px at 1440×900, 672px at 1280×800, 592px at 1280×720, and 652px at 1100×780. The Model and Roadmap surfaces cap their minimum height at 480px, Gate at 560px, and Ledger at 640px, all constrained by the same viewport budget. Each uses one drawing frame with a shared title band and fully ruled content cells. Policy and record fields occupy 60% of the body beside the explanation/facts cell, separated by a 1px rule. Model titles use 24px with 16px copy; Roadmap versions use 32px above 24px release titles. The desktop hero gives the diagram a larger column and a height allowance based on the slide minus 256px. Its equal 32px desktop insets, 24px column gap and ruled diagram title block keep the heading, controls and crate/queue facts together inside the slide without changing diagram geometry. At 1099px and below, sections return to natural height and continuous scrolling so longer content is never cropped. The masthead remains on the gray plane, 80px tall at wide sizes and 128px when links wrap below 850px. The footer closes the deck as a matching white outlined sheet.

**The One Section per Sheet Rule.** Keep every major section and the footer on its own outlined white surface, with the gray canvas visible between sheets.

Every section link aligns its surface top directly beneath the sticky header, with no canvas gap or strip of the previous section above it. Initial URL fragments use the same alignment. Direct navigation commits the clicked section while the indicator glides; manual scrolling tracks the section crossing a 1px band immediately below the header, retaining the last active section through inter-sheet gaps. Initial alignment, font/viewport changes, and reduced-motion preference place the indicator without travel.

**The Ruled Sequence Rule.** Keep related stages, releases and evidence inside one shared drawing frame, divided by fine rules. Use verdict colors for decisions and white paper for the evidence surface.

## Elevation & Depth

The interface uses no box shadows. The background plane separates the white slide sheets; thin rules organize their drawing cells, while the isometric illustration carries its own volume. The sticky navigation blends into the canvas at rest and remains borderless when sticky.

## Shapes

Each section and the footer share square corners and a 1px gray outline. The page plane stays visible as a consistent 24px inter-slide gap. The hero and four supporting sections use equal 32px desktop, 24px tablet and 16px phone insets. Buttons, secondary surfaces and the native release hit target use square corners. The navigation remains open text on the canvas, with only the moving 2px active underline. The isometric illustration carries its own rounded platform and station geometry.

## Components

### Iconography
Interface icons use the official `@hugeicons/react` renderer with named imports from `@hugeicons/core-free-icons`, a shared 1.5 stroke and `currentColor`. Sizes follow their roles: 16px stage chevrons, 14px verdict marks, 16px ledger checks and header arrow, and 20px playback/action icons. Stage names retain 12px text on desktop and 11px on mobile in a wrapping ordered list; separators stay attached to their following label. The current stage has 650 weight and a neutral background covering its complete label box with 6px vertical and 8px horizontal padding; chevrons stay outside the highlight, with its bold width reserved to prevent reflow. Playback is an icon-only 44px button in its own column, with an action tooltip and accessible name. There is no separate stage readout. Decorative icons are hidden from assistive technology. Keep the authored brand mark and isometric illustration separate from interface iconography.

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
- **Internal Padding:** Supporting frames use equal 16/24/32px outer insets. Cells use 24px desktop and 16px mobile side padding.

### Navigation
- **Style:** Medium-weight Geist links rest directly on the gray canvas, with 28px gaps on wide screens, 15px type, and 44px-high targets.
- **Default / Hover / Active:** Inactive links are muted gray; hover darkens the text. The current section uses near-black text and one shared 2px underline flush with the masthead bottom edge, retaining `aria-current` semantics. The line glides to the active label and matches its text width over 260ms with cubic-bezier(.25,1,.5,1); CSS transform transitions retarget during rapid navigation. Clicking selects the destination immediately and holds it through intervening sections; arrival or manual wheel, touch, scrollbar/pointer, or scroll-key input returns tracking to the section observer. Initial placement and responsive/font alignment are immediate, and reduced motion removes the travel.
- **Scrolled / Responsive:** The sticky header stays directly on the canvas with no added border. Below 850px the links take their own row, distributed evenly with 8px gaps and 14px text. The brand and action stay together above them; the decorative action arrow hides below 380px.
- **Focus:** Keep a visible keyboard outline with a 2px offset.

### Policy Panel
The policy sheet has a shared title band, explanation cell, and white evidence table with a compact metadata header, three ruled verdict rows and an implementation footer. Code stays near-black, supporting text is gray, and each verdict retains its semantic color and Hugeicons mark. All wording is preserved.

### Supporting drawing sheets
Model, Gate, Ledger and Roadmap share a ruled title band: a small uppercase Geist Mono label in a narrow cell and a Geist heading in the broad cell. Model uses four fully bounded stage cells. Gate joins explanation and policy evidence with a vertical rule. Ledger adds individually ruled checked facts and three-field record rows. Roadmap uses version bands above release descriptions. Desktop minimum-height caps follow content density: 480px for Model/Roadmap, 560px for Gate and 640px for Ledger, within the viewport slide budget.

Above 900px, title-band dividers continue the content grid: a 25/75 split for Model/Roadmap and 40/60 for Gate/Ledger. Roadmap versions, titles and descriptions share subgrid rows so a two-line title never changes the description baseline beside it. Stage/release title-to-copy spacing is 12px; titles use 1.2 line-height and explanatory stage/release copy shares the 1.65 body rhythm. Paragraphs use pretty wrapping to avoid isolated final words. Evidence verdict line-height remains unitless.

Below 900px, evidence columns stack and Model/Roadmap become two-column grids. At 600px and below, headers, stages and releases form a single-column reading sequence. Mobile ledger records keep an unbroken verdict in an 80px cell, with agent and intent stacked in the adjacent cell. No content is removed or abbreviated.

### Footer drawing sheet

The footer uses the same equal 32/24/16px foreground insets and one continuous inner drawing frame. Its brand and supporting copy share the left 40% of the title band; the headline occupies the right 60%. The desktop link grid sits below the headline, leaving the bridge clear at left. The user's charcoal intaglio/block-print panorama, with its vermilion bridge, is a full-width background behind this foreground grid. It extends to the footer's outer edges and retains its natural 2164:727 ratio without clipping, distortion or a separate image-band border. Each link list shares one even white backing with feathered edges (12px blur and 12/20px bleed). Individual links are transparent, avoiding hard word-sized patches while keeping the skyline visible between groups. A responsive 144–280px lower clearance keeps the panorama visible above the opaque credit row; desktop footer height stays within 780px. Below 900px links span the foreground width; at 600px and below, the title band stacks as logo, headline and copy, Explore and Crate share two columns, Related projects occupies its own row, and credits stack. Existing copy and destinations are preserved, including the linked ERP•AI project credit. Artwork provenance, prompts and the PNG master live in `site/artwork/`.

### Footer atmosphere

The footer print is layered: a boatless engraved waterfront, three independently drifting translucent fog banks, and three sailboat sprites with short reflections. Fog uses 64/73/82-second linear passes at different heights and opacities; boats follow 44/52/62-second forward routes with gentle vertical movement and edge fades. All moving properties are transform and opacity. The fuzzy cloud shapes come from a transparent image asset rather than geometric gradient blobs.

Dark mode reverses only the waterfront and boat ink. Fog retains a pale silver body, with a static 8px blur, 55% vertical scale and 10/14/6% layer opacity. This creates thin, translucent coastal mist rather than inverted dark clouds. Light-mode fog keeps its original height, shading and opacity. The moving parent groups retain their existing paths and playback clocks.

The credits start with a content-width copyright cell, followed by the project credit and adjacent 48px icon-only playback and theme cells using Hugeicons. On phones the copyright and two controls share the first row; the project credit spans a second bordered row. Playback has accessible Pause/Resume names and tooltips; the theme control exposes its Dark mode pressed state and the destination theme in its tooltip. Pausing preserves the exact frame and resuming continues it. IntersectionObserver and document visibility suspend the scene when it cannot be seen; initial and live reduced motion retain still clouds and boats and disable playback. Foreground links share a soft paper veil per group and remain fully operable. Layer masters and generation prompts are recorded in `site/artwork/footer-motion.md`.

### Decision Diagram
The isometric flow is the signature illustration. Keep its crowded intake, gate, human-release branch, linked-record ledger, and checked green production output readable at desktop and phone sizes. Geist Mono labels sit detached from the solids; the native release hit target remains keyboard accessible.

### Diagram title block and stage motion
Queue state, crate facts, stage progress, playback and the explanatory legend share one drawing-style caption with a 1px outer frame. The upper band contains the hold count and three crate facts; 10px uppercase Geist Mono labels sit above 18px tabular values. A horizontal rule separates the breadcrumb row, with a dedicated 48px playback cell and vertical divider. The legend occupies a quiet final band with a top rule. No gaps separate these bands.

On desktop, the intro and illustration occupy the upper row and this title block spans both columns beneath them, creating one shared baseline. The figure inherits the hero's column and row tracks through CSS subgrid. Hero content uses equal insets on all four sides: 32px on desktop, 24px on tablet, and 16px at 600px and below. Below 1100px, the block stays attached to its illustration, with the hold cell spanning a row above the three facts; mobile labels use 9px. Breadcrumbs wrap between complete items while playback fills its own cell. The single-column diagram, caption and intro share the same left and right edges; the former phone diagram bleed and tablet width cap are removed. The separate hero location line and old statistics footer remain removed.

The shared two-column hero and full-width drawing-block baseline also apply from 761–1099px, without the desktop slide-height constraint. This keeps stage controls and the legend from being compressed into a narrow diagram column. At 760px and below, the diagram and its attached block precede the intro in the continuous single-column composition.

One persistent background rectangle moves between breadcrumb labels with a transform-only 260ms `cubic-bezier(.25,1,.5,1)` transition, driven by the illustration's stage events. It fits the complete padded label and travels in both axes when the list wraps. Pause freezes an in-flight transition and prevents hover from changing the stage; resume continues it. Initial placement, font/viewport reflow and reduced motion align immediately.

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
