import { cx } from "../../helpers/cx";
import { displayHeading, pricingSection } from "../../styles/classes";
import { Kicker } from "../shared/Kicker";
import { Tag } from "../shared/Tag";

export function PricingHero() {
  return (
    <section className={cx(pricingSection, "pb-12 mobile:pb-8")} aria-labelledby="pricing-title">
      <Kicker>Pricing</Kicker>
      <h1 id="pricing-title" className={cx(displayHeading, "max-w-190")}>
        Free to self-host. Pay as you grow on Floodwall Cloud.
      </h1>
      <p className="mt-6 max-w-180 text-lg leading-body text-muted mobile:text-base">
        The crate is open source and always free to run yourself. Floodwall Cloud hosts the ledger, approvals and
        console for you, billed by the decisions your agents&rsquo; changes need.
      </p>
      <div className="mt-6 flex">
        <Tag>Hosted plans by invitation during early access</Tag>
      </div>
    </section>
  );
}
