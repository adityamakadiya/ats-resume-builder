import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/*
  One primary, one secondary, one refusal.

  The blue is the only colour that commits to anything, so `default` is the
  blue and nothing else is. `outline` is a white surface with a hairline,
  which is what a second action looks like next to it. `destructive` is the
  refusal red, used for the handful of actions that remove something.

  Heights are set here rather than patched at every call site: `lg` is 44px
  because that is the smallest thing a thumb hits reliably, and the sign in
  button is the most important 44px in the product.
*/

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-[3px] focus-visible:ring-stamp/25 disabled:pointer-events-none disabled:opacity-55 aria-invalid:border-[var(--refused)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-stamp text-paper-raised shadow-xs hover:bg-[var(--stamp-strong)]",
        outline:
          "border-rule bg-paper-raised text-ink shadow-xs hover:bg-paper-sunk aria-expanded:bg-paper-sunk",
        secondary:
          "bg-paper-sunk text-ink hover:bg-[color-mix(in_srgb,var(--paper-sunk),var(--ink)_6%)]",
        ghost:
          "text-ink-muted hover:bg-paper-sunk hover:text-ink aria-expanded:bg-paper-sunk aria-expanded:text-ink",
        destructive:
          "bg-[var(--refused)] text-paper-raised shadow-xs hover:bg-[color-mix(in_srgb,var(--refused),black_10%)] focus-visible:ring-[var(--refused)]/25",
        link: "text-[var(--stamp-strong)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5",
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-2.5 text-[0.8125rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 px-5 text-[0.9375rem]",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-md",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
