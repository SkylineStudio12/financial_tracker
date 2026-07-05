import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Base UI button styled with OUR semantic tokens only (docs/design-tokens.md).
 * Behavior comes from the primitive; every visual value is a token.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-input border border-transparent text-secondary whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground hover:bg-accent-hover",
        secondary:
          "border-border-input bg-surface text-text-primary hover:border-accent",
        // outline = the quiet secondary look (registry components expect it)
        outline:
          "border-border-input bg-surface text-text-primary hover:border-accent",
        ghost: "text-text-muted hover:text-text-primary",
        destructive:
          "border-border-input bg-surface text-status-negative-text hover:border-status-negative-text",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[var(--density-control-height)] px-4",
        sm: "h-8 px-3",
        icon: "size-8 rounded-badge",
        "icon-sm": "size-7 rounded-badge",
        "icon-xs": "size-6 rounded-badge",
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
