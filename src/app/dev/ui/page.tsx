import { Button } from "@/components/ui/button";

/**
 * DEV-ONLY: primitive showcase for design-token confirmation (phase 2.6
 * stage 1). Not linked from navigation; remove when no longer useful.
 */
export default function UiDevPage() {
  return (
    <div className="min-h-screen bg-canvas p-[var(--density-card-padding)]">
      <div className="mx-auto flex max-w-xl flex-col gap-[var(--density-section-gap)]">
        <h1 className="text-title text-text-primary">Primitives — token check</h1>

        <section className="flex flex-col gap-3 rounded-card border border-border-hairline bg-surface p-[var(--density-card-padding)]">
          <h2 className="text-micro uppercase text-text-muted">Button</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary action</Button>
            <Button variant="secondary">Secondary</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Delete</Button>
            <Button disabled>Disabled</Button>
          </div>
          <p className="text-caption text-text-muted">
            Primary: accent / accent-foreground / accent-hover. Secondary: quiet
            border-input style. Tab through to see the focus-ring token.
          </p>
        </section>
      </div>
    </div>
  );
}
