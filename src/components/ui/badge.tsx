import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
 "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-caption font-medium whitespace-nowrap transition-all focus-visible:border-border-input focus-visible:ring-[3px] focus-visible:ring-focus-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-status-negative-text aria-invalid:ring-status-negative-text/20  [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground [a]:hover:bg-accent-hover",
        secondary:
 "bg-surface-inactive text-text-primary [a]:hover:bg-surface-inactive",
        destructive:
 "bg-status-negative-text/10 text-status-negative-text focus-visible:ring-status-negative-text/20   [a]:hover:bg-status-negative-text/15",
        outline:
 "border-border-hairline text-text-primary [a]:hover:bg-surface-inactive [a]:hover:text-text-muted",
        ghost:
 "hover:bg-surface-inactive hover:text-text-muted ",
        link: "text-accent underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
