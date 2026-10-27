import { PRICING_COMPARISON, PRICING_PLANS } from "../../constants/pricing";
import { cx } from "../../helpers/cx";
import { card, pricingSection } from "../../styles/classes";
import { SectionHeading } from "../shared/SectionHeading";
import { Card } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

/** The feature column, pinned while the plans scroll under it on a phone. */
const STICKY_COLUMN =
  "sticky left-0 z-1 h-auto px-4 mobile:w-36 mobile:border-r mobile:border-r-line mobile:whitespace-normal";

export function PricingCompareSection() {
  return (
    <section className={pricingSection} aria-labelledby="compare-title">
      <SectionHeading id="compare-title" kicker="Compare">
        Plans side by side.
      </SectionHeading>
      <Card className={cx(card, "block overflow-hidden")}>
        <Table>
          <TableHeader>
            <TableRow className="bg-paper hover:bg-paper">
              <TableHead className={cx(STICKY_COLUMN, "bg-paper py-3")}>
                <span className="sr-only">Feature</span>
              </TableHead>
              {PRICING_PLANS.map(({ name }) => (
                <TableHead
                  key={name}
                  className="h-auto px-4 py-3 text-xs font-bold tracking-[0.04em] text-muted uppercase"
                >
                  {name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {PRICING_COMPARISON.map(({ feature, values }) => (
              <TableRow key={feature} className="hover:bg-transparent">
                <TableCell className={cx(STICKY_COLUMN, "bg-white py-3 font-semibold text-ink")}>{feature}</TableCell>
                {values.map((value, index) => (
                  <TableCell key={PRICING_PLANS[index].name} className="px-4 py-3 text-ink-soft">
                    {value}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  );
}
