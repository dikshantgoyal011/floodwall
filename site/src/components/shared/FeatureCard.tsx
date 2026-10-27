import type { ReactNode } from "react";
import { cx } from "../../helpers/cx";
import { bulletItem, card } from "../../styles/classes";
import { Card } from "../ui/card";
import { Kicker } from "./Kicker";

type FeatureCardProps = {
  kicker: string;
  titleId: string;
  title: string;
  /** Optional bullet points under the copy. */
  points?: string[];
  /** Placement within the section, such as its order in the grid. */
  className?: string;
  children: ReactNode;
};

/** Light card (shadcn's Card) with a kicker, heading, and copy; one half of a split section. */
export function FeatureCard({ kicker, titleId, title, points, className, children }: FeatureCardProps) {
  return (
    <Card className={cx(card, "block p-(--spacing-card-lg) shadow-card", className)}>
      <Kicker>{kicker}</Kicker>
      <h2 id={titleId} className="font-display text-display-md leading-[1.05] font-normal">
        {title}
      </h2>
      <p className="mt-4 text-lg leading-body text-muted mobile:text-base">{children}</p>
      {points && (
        <ul className="mt-6 grid gap-3 border-t border-t-line pt-6">
          {points.map((point) => (
            <li key={point} className={bulletItem}>
              {point}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
