import { useSectionLinks, useSectionReveal } from "./hooks";
import { GateSection } from "./sections/GateSection";
import { Hero } from "./sections/Hero";
import { LedgerSection } from "./sections/LedgerSection";
import { ModelSection } from "./sections/ModelSection";
import { RoadmapSection } from "./sections/RoadmapSection";
import { SiteFooter } from "./sections/SiteFooter";
import { SiteHeader } from "./sections/SiteHeader";
import { WaitlistSection } from "./sections/WaitlistSection";

export default function App() {
  useSectionLinks();
  useSectionReveal();

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
        <WaitlistSection />
      </main>
      <SiteFooter />
    </>
  );
}
