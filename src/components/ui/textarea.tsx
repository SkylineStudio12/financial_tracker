import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
 "flex field-sizing-content min-h-16 w-full rounded-input border border-border-hairline-input bg-transparent px-2.5 py-2 text-body transition-colors outline-none placeholder:text-text-muted focus-visible:border-border-input focus-visible:ring-3 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:bg-surface-inactive disabled:opacity-50 aria-invalid:border-status-negative-text aria-invalid:ring-3 aria-invalid:ring-status-negative-text/20 md:text-secondary ",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
