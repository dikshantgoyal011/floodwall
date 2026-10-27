/** Join class lists, skipping the ones a condition left out. */
export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
