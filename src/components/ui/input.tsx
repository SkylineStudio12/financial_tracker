import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
 "h-8 w-full min-w-0 rounded-input border border-border-hairline-input bg-transparent px-2.5 py-1 text-body transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-secondary file:font-medium file:text-text-primary placeholder:text-text-muted focus-visible:border-border-input focus-visible:ring-3 focus-visible:ring-focus-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-surface-inactive disabled:opacity-50 aria-invalid:border-status-negative-text aria-invalid:ring-3 aria-invalid:ring-status-negative-text/20 md:text-secondary ",
        className
      )}
      {...props}
    />
  )
}

export { Input }
