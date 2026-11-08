import { PRICING_COMPARISON, PRICING_PLANS } from "../../constants/pricing";
import { LandingSectionHeading } from "../landing/LandingSectionHeading";

/** Every plan against every feature in one ruled table; on a phone the plans scroll under the feature column. */
export function PricingCompareSection() {
  return (
    <section className="section" aria-labelledby="compare-title">
      <div className="section-drawing">
        <LandingSectionHeading id="compare-title" kicker="Compare">
          Plans <strong>side by side.</strong>
        </LandingSectionHeading>
        <div className="compare-scroll" role="region" aria-labelledby="compare-title" tabIndex={0}>
          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Feature</span>
                </th>
                {PRICING_PLANS.map(({ name, featured }) => (
                  <th key={name} scope="col" data-featured={featured || undefined}>
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PRICING_COMPARISON.map(({ feature, values }) => (
                <tr key={feature}>
                  <th scope="row">{feature}</th>
                  {values.map((value, index) => (
                    <td key={PRICING_PLANS[index].name} data-empty={value === "—" || undefined}>
                      {value === "—" ? <span aria-label="Not included">—</span> : value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
