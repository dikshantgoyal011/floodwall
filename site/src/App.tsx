import { LandingGateSection } from "./components/landing/LandingGateSection";
import { LandingHero } from "./components/landing/LandingHero";
import { LandingLedgerSection } from "./components/landing/LandingLedgerSection";
import { LandingModelSection } from "./components/landing/LandingModelSection";
import { LandingRoadmapSection } from "./components/landing/LandingRoadmapSection";

/** The landing page's sections; SiteLayout puts the header and footer around them. */
export default function App() {
  return (
    <>
      <LandingHero />
      <LandingModelSection />
      <LandingGateSection />
      <LandingLedgerSection />
      <LandingRoadmapSection />
    </>
  );
}
