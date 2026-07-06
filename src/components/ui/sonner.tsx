"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Sonner toaster styled with OUR semantic tokens (docs/design-tokens.md).
 * Theme is pinned to light — the app is light-first with no dark mode.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon absoluteStrokeWidth strokeWidth={1.5} className="size-4 text-status-positive-text" />,
        info: <InfoIcon absoluteStrokeWidth strokeWidth={1.5} className="size-4" />,
        warning: <TriangleAlertIcon absoluteStrokeWidth strokeWidth={1.5} className="size-4 text-status-warning-text" />,
        error: <OctagonXIcon absoluteStrokeWidth strokeWidth={1.5} className="size-4 text-status-negative-text" />,
        loading: <Loader2Icon absoluteStrokeWidth strokeWidth={1.5} className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--color-surface-raised)",
          "--normal-text": "var(--color-text-primary)",
          "--normal-border": "var(--color-border-hairline)",
          "--border-radius": "var(--radius-input)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "font-sans text-secondary shadow-raised",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
