/** Short label set above a heading. */
export function Kicker({ children }: { children: string }) {
  return <p className="mb-4 text-xs font-bold tracking-[0.04em] text-bridge uppercase">{children}</p>;
}
