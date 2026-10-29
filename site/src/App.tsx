import { useCenteredSectionLinks } from "./hooks";
import { GateSection } from "./sections/GateSection";
import { Hero } from "./sections/Hero";
import { LedgerSection } from "./sections/LedgerSection";
import { ModelSection } from "./sections/ModelSection";
import { RoadmapSection } from "./sections/RoadmapSection";
import { SiteFooter } from "./sections/SiteFooter";
import { SiteHeader } from "./sections/SiteHeader";

export default function App() {
  useCenteredSectionLinks();

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <ModelSection />
        <GateSection />
        <LedgerSection />
        <RoadmapSection />
      </main>
      <SiteFooter />
    </>
  );
}
