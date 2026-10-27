import { displayHeading } from "../../styles/classes";
import { Kicker } from "./Kicker";

type SectionHeadingProps = { id: string; kicker: string; children: string };

/** Kicker plus display heading that opens a full-width section. */
export function SectionHeading({ id, kicker, children }: SectionHeadingProps) {
  return (
    <header className="mb-12 max-w-190 mobile:mb-8">
      <Kicker>{kicker}</Kicker>
      <h2 id={id} className={displayHeading}>
        {children}
      </h2>
    </header>
  );
}
