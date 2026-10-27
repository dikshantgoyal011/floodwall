import { useLocation } from "react-router";

/**
 * Whether this is the landing page, and how to link to its sections from
 * here: "#model" stays an in-page anchor on the landing page and becomes
 * "/#model" on any other. Links that aren't anchors pass through as they are.
 */
export function useLandingLinks() {
  const onLanding = useLocation().pathname === "/";
  const sectionHref = (href: string) => (onLanding || !href.startsWith("#") ? href : `/${href}`);
  return { onLanding, sectionHref };
}
