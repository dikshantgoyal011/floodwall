import { LandingGateSection } from "./components/landing/LandingGateSection";
import { LandingHero } from "./components/landing/LandingHero";
import { LandingLedgerSection } from "./components/landing/LandingLedgerSection";
import { LandingLineSection } from "./components/landing/LandingLineSection";
import { LandingModelSection } from "./components/landing/LandingModelSection";
import { LandingRoadmapSection } from "./components/landing/LandingRoadmapSection";
import { LandingWaitlistSection } from "./components/landing/LandingWaitlistSection";
import { useSectionLinks } from "./hooks/useSectionLinks";
import { useSectionReveal } from "./hooks/useSectionReveal";

/** The landing page's sections; SiteLayout puts the header and footer around them. */
export default function App() {
  useSectionLinks();
  useSectionReveal();

  return (
    <>
      <LandingHero />
      <LandingLineSection />
      <LandingModelSection />
      <LandingGateSection />
      <LandingLedgerSection />
      <LandingRoadmapSection />
      <LandingWaitlistSection />
    </>
  );
}
