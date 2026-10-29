import type { ReactNode } from "react";

type SectionHeadingProps = { id: string; kicker: string; children: ReactNode };

/** A ruled drawing-title band: a label-width ruled tab above a full-width heading. */
export function SectionHeading({ id, kicker, children }: SectionHeadingProps) {
  return (
    <header className="section-heading">
      <p className="kicker">{kicker}</p>
      <h2 id={id} className="display-heading staccato-heading">
        {children}
      </h2>
    </header>
  );
}
