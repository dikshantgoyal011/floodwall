/** The placeholder shown where a list or table has nothing in it. */
export function ConsoleEmpty({ children }: { children: string }) {
  return <p className="p-6 text-center text-muted">{children}</p>;
}
