import { LandingGateSection } from "./components/landing/LandingGateSection";
import { LandingHero } from "./components/landing/LandingHero";
import { LandingLedgerSection } from "./components/landing/LandingLedgerSection";
import { LandingLineSection } from "./components/landing/LandingLineSection";
import { LandingModelSection } from "./components/landing/LandingModelSection";
import { LandingRoadmapSection } from "./components/landing/LandingRoadmapSection";
import { LandingWaitlistSection } from "./components/landing/LandingWaitlistSection";
import { SiteFooter } from "./components/shared/SiteFooter";
import { SiteHeader } from "./components/shared/SiteHeader";
import { useSectionLinks } from "./hooks/useSectionLinks";
import { useSectionReveal } from "./hooks/useSectionReveal";
import { useSiteDocument } from "./hooks/useSiteDocument";

/** The landing page, with its own header and footer. styles/landing styles the whole document. */
export default function App() {
  useSectionLinks();
  useSectionReveal();
  useSiteDocument();

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        <LandingHero />
        <LandingLineSection />
        <LandingModelSection />
        <LandingGateSection />
        <LandingLedgerSection />
        <LandingRoadmapSection />
        <LandingWaitlistSection />
      </main>
      <SiteFooter />
    </>
  );
}
