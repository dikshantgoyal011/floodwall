import { cx } from "../../helpers/cx";
import { cardCopy } from "../../styles/classes";
import { Tag } from "./Tag";

type CardRailProps = {
  items: readonly { title: string; copy: string }[];
  /** The grid's columns at each width. */
  className: string;
};

/** Cells joined by hairlines into one card, each a tagged title over its copy. */
export function CardRail({ items, className }: CardRailProps) {
  return (
    <div className={cx("grid gap-px overflow-hidden rounded-card border border-line bg-line shadow-card", className)}>
      {items.map(({ title, copy }) => (
        <article
          className="flex flex-col gap-6 [background:linear-gradient(180deg,rgba(255,255,255,0.94),rgba(232,242,248,0.62)),#fff] p-card"
          key={title}
        >
          <Tag render={<h3 />}>{title}</Tag>
          <p className={cardCopy}>{copy}</p>
        </article>
      ))}
    </div>
  );
}
