import type { ReactNode } from "react";
import { cx } from "../../helpers/cx";
import { monoLabel, pageWidth } from "../../styles/classes";
import { LogoLink } from "../shared/LogoLink";

type AuthPageProps = { kicker?: string; title: string; lead: string; children: ReactNode };

/**
 * The page the sign-in, sign-up and account screens share, kept out of search: the brand on the
 * gray plane and one white drawing sheet, as on the landing page. A ruled title band holds the
 * title and lead; below it, each child is a ruled row of the sheet.
 */
export function AuthPage({ kicker, title, lead, children }: AuthPageProps) {
  return (
    <main className="min-h-svh bg-paper">
      <div className={cx(pageWidth, "max-w-140 py-section mobile:py-8")}>
        <meta name="robots" content="noindex, nofollow" />
        <LogoLink className="mb-8 mobile:mb-6">Floodwall</LogoLink>
        <section className="border border-line bg-surface" aria-labelledby="auth-title">
          <header className="border-b border-b-line">
            {kicker && (
              <p className={cx(monoLabel, "inline-flex min-h-7 items-center border-r border-b border-line px-4")}>
                {kicker}
              </p>
            )}
            <h1
              id="auth-title"
              className={cx(
                "px-6 pb-2 text-[clamp(30px,3vw,40px)] leading-[1.08] font-[550] tracking-[-0.035em] text-balance text-ink mobile:px-4",
                kicker ? "pt-5" : "pt-6",
              )}
            >
              {title}
            </h1>
            <p className="max-w-[46ch] px-6 pb-6 text-base leading-body text-pretty text-muted mobile:px-4">{lead}</p>
          </header>
          <div
            className={cx(
              "flex flex-col text-sm leading-body text-muted",
              "[&>*]:px-6 [&>*]:py-5 [&>*+*]:border-t [&>*+*]:border-t-line mobile:[&>*]:px-4",
              "[&_p>a]:font-medium [&_p>a]:text-ink [&_p>a]:underline [&_p>a]:decoration-line [&_p>a]:underline-offset-4 hover:[&_p>a]:decoration-ink",
            )}
          >
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
