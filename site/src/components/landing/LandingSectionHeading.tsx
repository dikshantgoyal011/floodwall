import type { ReactNode } from "react";

type SectionHeadingProps = { id: string; kicker: string; children: ReactNode; level?: 1 | 2 };

/** A ruled drawing-title band: a label-width ruled tab above a full-width heading. */
export function LandingSectionHeading({ id, kicker, children, level = 2 }: SectionHeadingProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <header className="section-heading">
      <p className="kicker">{kicker}</p>
      <Heading id={id} className="display-heading staccato-heading">
        {children}
      </Heading>
    </header>
  );
}
