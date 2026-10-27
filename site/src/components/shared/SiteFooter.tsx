import { FOOTER_GROUPS, PROTO_URL } from "../../constants/links";
import { FOOTER_POSTER_URL, HERO_VIDEO_URL } from "../../constants/media";
import { cx } from "../../helpers/cx";
import { useLandingLinks } from "../../hooks/useLandingLinks";
import { useVideoEligibility } from "../../hooks/useVideoEligibility";
import { displayHeading, pageWidth } from "../../styles/classes";
import { AmbientVideo } from "./AmbientVideo";
import { Kicker } from "./Kicker";
import { LogoLink } from "./LogoLink";
import { SiteFooterScene } from "./SiteFooterScene";

/** The footer on the landing and pricing pages. */
export function SiteFooter() {
  const canPlayVideo = useVideoEligibility();
  const { sectionHref } = useLandingLinks();

  return (
    <footer
      className={cx(
        "relative isolate overflow-hidden",
        "[background:var(--background-footer)]",
        // Wash and grid laid over the video so the copy stays readable.
        "before:pointer-events-none before:absolute before:inset-0 before:z-2 before:bg-(image:--image-footer-wash)",
        "after:pointer-events-none after:absolute after:inset-0 after:z-2 after:bg-(image:--image-footer-grid) after:bg-size-[72px_72px] after:opacity-6",
        "after:mask-[linear-gradient(180deg,#000_0_46%,transparent_86%)]",
      )}
    >
      {canPlayVideo && (
        <AmbientVideo
          className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover object-[center_58%] opacity-92 filter-[saturate(1.05)_contrast(1.04)_brightness(1.08)]"
          src={HERO_VIDEO_URL}
          poster={FOOTER_POSTER_URL}
        />
      )}
      <SiteFooterScene />

      <div
        className={cx(
          pageWidth,
          "relative z-3 grid min-h-205 grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] grid-rows-[1fr_auto] gap-x-18 gap-y-12 pt-section pb-8",
          "tablet:grid-cols-[1fr] mobile:min-h-0 mobile:gap-12",
        )}
      >
        <div className="max-w-140">
          <LogoLink className="mb-8">Floodwall</LogoLink>
          <Kicker>San Francisco Bay / production traffic</Kicker>
          <h2 className={displayHeading}>Built where fog meets production traffic.</h2>
          <p className="mt-6 max-w-120 text-lg leading-body text-ink-soft mobile:text-base">
            A bright control-plane surface for the moment agents start moving faster than human
            review queues.
          </p>
        </div>

        <nav
          className="grid w-[min(560px,100%)] grid-cols-3 gap-8 [justify-self:end] tablet:justify-self-stretch mobile:grid-cols-2 mobile:gap-x-6 mobile:gap-y-8 mobile:*:last:col-span-full"
          aria-label="Footer"
        >
          {FOOTER_GROUPS.map(({ title, links }) => (
            <div key={title}>
              <h3 className="mb-4 text-sm font-bold text-ink">{title}</h3>
              <ul className="grid gap-3">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    <a
                      className="text-sm font-semibold text-[#49616c] transition-[color] duration-180 ease-[ease] hover:text-black focus-visible:text-black"
                      href={sectionHref(href)}
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="col-span-full flex justify-between gap-x-6 gap-y-2 [align-self:end] border-t border-t-[rgba(8,11,13,0.14)] pt-6 text-sm text-[#38515c] mobile:mt-12 mobile:flex-col">
          <strong className="text-xs tracking-[0.04em] text-ink uppercase">San Francisco Bay</strong>
          <span>
            &copy; {new Date().getFullYear()} Floodwall. An ERP.AI project. · Built with{" "}
            <a
              className="font-semibold underline underline-offset-3 hover:text-black focus-visible:text-black"
              href={PROTO_URL}
            >
              Proto
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
