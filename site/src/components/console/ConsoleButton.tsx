import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "../ui/button";

type ConsoleButtonProps = {
  variant?: "primary" | "secondary";
  /** Renders a router link to this path instead of a <button>. */
  to?: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Button>, "variant" | "size" | "render" | "nativeButton">;

const VARIANT = { primary: "default", secondary: "outline" } as const;

/** The console's solid (primary) or outlined (secondary) button: shadcn's Button. */
export function ConsoleButton({ variant = "primary", to, children, type = "button", ...rest }: ConsoleButtonProps) {
  if (to) {
    return (
      <Button variant={VARIANT[variant]} size="lg" className="px-4" nativeButton={false} render={<Link to={to} />}>
        {children}
      </Button>
    );
  }
  return (
    <Button variant={VARIANT[variant]} size="lg" className="px-4" type={type} {...rest}>
      {children}
    </Button>
  );
}
