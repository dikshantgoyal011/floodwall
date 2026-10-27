import { PricingCompareSection } from "../components/pricing/PricingCompareSection";
import { PricingFaqSection } from "../components/pricing/PricingFaqSection";
import { PricingHero } from "../components/pricing/PricingHero";
import { PricingIncludedSection } from "../components/pricing/PricingIncludedSection";
import { PricingPlansSection } from "../components/pricing/PricingPlansSection";
import { PricingProgramsSection } from "../components/pricing/PricingProgramsSection";

/** Floodwall's plans: free to self-host, usage-based on Floodwall Cloud. Reachable by URL only. */
export function PricingPage() {
  return (
    <>
      {/* Kept out of search, like the console, until the page goes public:
       * then drop this tag and list /pricing in public/sitemap.xml. */}
      <meta name="robots" content="noindex, nofollow" />
      <PricingHero />
      <PricingPlansSection />
      <PricingIncludedSection />
      <PricingCompareSection />
      <PricingProgramsSection />
      <PricingFaqSection />
    </>
  );
}
