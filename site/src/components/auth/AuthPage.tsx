import type { ReactNode } from "react";
import { cx } from "../../helpers/cx";
import { pageWidth } from "../../styles/classes";
import { Kicker } from "../shared/Kicker";
import { LogoLink } from "../shared/LogoLink";

type AuthPageProps = { kicker?: string; title: string; lead: string; children: ReactNode };

/**
 * The page the sign-in, sign-up and account screens share: a narrow column on
 * the site's background, with no header or footer, kept out of search.
 */
export function AuthPage({ kicker, title, lead, children }: AuthPageProps) {
  return (
    <main className="min-h-svh bg-[linear-gradient(180deg,var(--color-paper)_0%,#fff_48%,#f1f7fb_100%)]">
      <section className={cx(pageWidth, "max-w-160 py-section")} aria-labelledby="auth-title">
        <meta name="robots" content="noindex, nofollow" />
        <LogoLink className="mb-12">Floodwall</LogoLink>
        {kicker && <Kicker>{kicker}</Kicker>}
        <h1 id="auth-title" className="font-display text-display-md leading-none text-ink">
          {title}
        </h1>
        <p className="mt-4 mb-8 text-lg leading-body text-muted mobile:text-base">{lead}</p>
        <div className="flex flex-col gap-6 text-base leading-body text-ink-soft [&_p>a]:font-semibold [&_p>a]:text-bay-deep [&_p>a]:underline-offset-4 hover:[&_p>a]:underline">
          {children}
        </div>
      </section>
    </main>
  );
}
