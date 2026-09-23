import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";

/**
 * A link that looks like a button.
 *
 * Not `<Button render={<Link/>}>`. Base UI's Button treats a non-button
 * element as a button and stamps `role="button"` on it, which takes an <a>
 * that navigates and tells assistive technology it is a control that acts in
 * place. Screen reader users then lose the "opens a page" affordance, and
 * the element stops appearing in a links list.
 *
 * This is a real anchor wearing the button's clothes: the same cva variants,
 * none of the semantics.
 */

export type LinkButtonProps = React.ComponentProps<typeof Link> &
  VariantProps<typeof buttonVariants>;

export function LinkButton({
  className,
  variant = "default",
  size = "default",
  ...props
}: LinkButtonProps) {
  return (
    <Link
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
