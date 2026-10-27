import type { SvgPath } from "../../types";

type SvgPathsProps = {
  paths: SvgPath[];
  /** Classes for the paths that bring none of their own. */
  className?: string;
};

/** The <path> elements of an SVG, drawn in order. */
export function SvgPaths({ paths, className }: SvgPathsProps) {
  return paths.map(({ d, className: own }) => <path key={d} className={own ?? className} d={d} />);
}
