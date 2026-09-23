import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

/*
  An input sits on the raised surface with a hairline, not in a sunken well.
  A well reads as disabled next to a white card, and the field someone types
  their email into should be the brightest thing in the form.
*/

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-lg border border-rule bg-paper-raised px-3 text-base text-ink transition-colors outline-none placeholder:text-ink-faint focus-visible:border-stamp focus-visible:ring-[3px] focus-visible:ring-stamp/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-paper-sunk disabled:opacity-60 aria-invalid:border-[var(--refused)] aria-invalid:ring-[3px] aria-invalid:ring-[var(--refused)]/15 md:text-[0.9375rem] dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

export { Input }
