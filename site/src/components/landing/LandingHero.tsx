import { Fragment } from "react";
import { CRATE_STATS, HERO_TITLE_LINES } from "../../constants/landing";
import { REPO_URL } from "../../constants/links";
import { HERO_VIDEO_URL } from "../../constants/media";
import { cx } from "../../helpers/cx";
import { useVideoEligibility } from "../../hooks/useVideoEligibility";
import { textLink } from "../../styles/classes";
import { AmbientVideo } from "../shared/AmbientVideo";
import { ButtonLink } from "../shared/ButtonLink";
import { Kicker } from "../shared/Kicker";
import { LandingHeroScene } from "./LandingHeroScene";

export function LandingHero() {
  const canPlayVideo = useVideoEligibility();

  return (
    <section
      className={cx(
        "relative isolate flex min-h-[calc(100svh-var(--spacing-header))] flex-col overflow-hidden [background:var(--image-hero),var(--color-paper)]",
        // Where the video starts; the veil fades it in below the headline.
        "[--hero-video-top:clamp(188px,calc(28svh-var(--spacing-header)),258px)]",
      )}
      id="home"
      aria-labelledby="hero-title"
    >
      <LandingHeroScene />
      {canPlayVideo && (
        <AmbientVideo
          className={cx(
            "pointer-events-none absolute inset-x-0 top-(--hero-video-top) bottom-0 z-0 h-[calc(100%-var(--hero-video-top))] w-full",
            "object-cover object-[center_top] opacity-0 transition-opacity duration-500 ease-[ease] data-[visible=true]:opacity-100",
            "filter-[saturate(0.86)_contrast(1.02)_brightness(1.1)] mask-[linear-gradient(180deg,transparent_20%,rgba(0,0,0,0.42)_32%,#000_48%)]",
          )}
          src={HERO_VIDEO_URL}
          fadeLoop
        />
      )}
      <div className="pointer-events-none absolute inset-0 z-1 bg-(image:--image-hero-veil)" aria-hidden="true" />

      <div
        className={cx(
          "relative z-2 mx-auto flex w-[min(1540px,100%-2*var(--spacing-gutter))] flex-1 flex-col items-center",
          "pt-[clamp(64px,10svh,112px)] pb-44 text-center mobile:items-start mobile:pt-12 mobile:pb-36 mobile:text-left",
        )}
      >
        <Kicker>San Francisco / agent ops / production gate</Kicker>
        <h1
          id="hero-title"
          className="animate-fade-rise font-display text-display-xl leading-[0.96] font-normal text-black mobile:text-[clamp(48px,15vw,72px)]"
        >
          {HERO_TITLE_LINES.map(({ text, emphasis }, index) => (
            <Fragment key={emphasis}>
              {index > 0 && " "}
              <span className="block">
                {text}
                <em className="text-quiet">{emphasis}</em>
              </span>
            </Fragment>
          ))}
        </h1>
        <p className="mt-8 max-w-180 animate-fade-rise-2 text-lg leading-body text-muted mobile:mt-6 mobile:text-base">
          Floodwall meters agent-generated infrastructure changes, verifies each intent at a policy
          gate, and records every admit, defer, and reject in a tamper-evident ledger.
        </p>
        <div className="mt-10 flex animate-fade-rise-3 flex-wrap items-center justify-center gap-x-6 gap-y-4 mobile:mt-8 mobile:w-full mobile:flex-col mobile:items-stretch">
          <ButtonLink href={REPO_URL} size="lg">
            View the Crate
          </ButtonLink>
          <a className={cx(textLink, "mobile:pl-1")} href="#model">
            Read the model
          </a>
        </div>
      </div>

      <dl
        className={cx(
          "absolute right-[max(var(--spacing-gutter),(100%-var(--container-content))/2)] bottom-8 z-3 grid grid-cols-[repeat(3,minmax(96px,1fr))]",
          "overflow-hidden rounded-card border border-line bg-[rgba(255,255,255,0.68)] shadow-[0_32px_88px_rgba(47,110,137,0.16)] backdrop-blur-[18px]",
          "tablet:right-gutter tablet:bottom-6 tablet:left-gutter mobile:grid-cols-3 mobile:rounded-[20px]",
        )}
        aria-label="Current crate state"
      >
        {CRATE_STATS.map(({ value, label }) => (
          <div
            key={label}
            className="flex min-w-0 flex-col-reverse justify-end gap-1 border-r border-r-[rgba(8,11,13,0.08)] px-5 py-4 last:[border-right:0] mobile:p-3 tiny:px-2"
          >
            <dt className="text-[11px] font-bold tracking-[0.02em] text-muted uppercase mobile:text-[10px] tiny:tracking-normal">
              {label}
            </dt>
            <dd className="text-xl leading-none font-bold text-black mobile:text-lg">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
