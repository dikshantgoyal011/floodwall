import type { ReactNode } from "react";

type SectionHeadingProps = { id: string; kicker: string; children: ReactNode };

/** A ruled drawing-title band, with a separate section-label cell. */
export function SectionHeading({ id, kicker, children }: SectionHeadingProps) {
  return (
    <header className="section-heading">
      <h2 id={id} className="display-heading staccato-heading">
        {children}
      </h2>
      <p className="kicker">{kicker}</p>
    </header>
  );
}
