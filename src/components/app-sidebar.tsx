"use client";

/**
 * App sidebar: profile switcher on top, grouped navigation, user block at
 * the bottom. Profiles come from the PROFILES config (src/lib/profiles) —
 * the switcher lists all five; company-only nav (salary/dividend flows)
 * renders only when the active profile has `companyFlows`. The active
 * profile is the /p/[profile] URL segment, so personal profiles highlight
 * exactly (stage 3).
 */

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  BanknoteIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CoinsIcon,
  HouseIcon,
  ImportIcon,
  LayoutDashboardIcon,
  MapIcon,
  Settings2Icon,
  ReceiptIcon,
  TrendingUpIcon,
  UserRoundIcon,
} from "lucide-react";
import { DrmxLogo, SkylineLogo } from "@/components/brand-logos";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { setLocaleAction } from "@/i18n/actions";
import { LOCALES } from "@/i18n/config";
import { getProfile, PROFILES, type Profile } from "@/lib/profiles";
import { cn } from "@/lib/utils";

const ICON_PROPS = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

/** Profile.subtitle (config literal) → catalog key under sidebar.subtitle. */
const SUBTITLE_KEY = { Shared: "shared", Personal: "personal", SRL: "srl" } as const;

function ProfileIcon({ profile, className }: { profile: Profile; className?: string }) {
  // Companies show their brand mark; personal/shared use Lucide icons.
  if (profile.slug === "skyline") return <SkylineLogo className={className} />;
  if (profile.slug === "drmx") return <DrmxLogo className={className} />;
  const Icon = profile.subtitle === "Personal" ? UserRoundIcon : HouseIcon;
  return <Icon className={className} {...ICON_PROPS} />;
}

function ProfileSwitcher({ activeProfile }: { activeProfile: Profile }) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const t = useTranslations("sidebar");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<SidebarMenuButton size="lg" aria-label={t("switchProfile")} />}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-badge bg-accent text-accent-foreground">
          <ProfileIcon profile={activeProfile} className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col text-left leading-tight">
          <span className="truncate font-medium text-secondary text-text-primary">
            {activeProfile.label}
          </span>
          <span className="text-caption text-text-muted">
            {t(`subtitle.${SUBTITLE_KEY[activeProfile.subtitle]}`)}
          </span>
        </span>
        <ChevronsUpDownIcon className="ml-auto size-4 text-text-muted" {...ICON_PROPS} />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        {PROFILES.map((profile) => (
          <button
            key={profile.slug}
            type="button"
            className="flex w-full items-center gap-2 rounded-badge px-2 py-1.5 text-left outline-none hover:bg-surface-inactive focus-visible:ring-3 focus-visible:ring-focus-ring"
            onClick={() => {
              setOpen(false);
              router.push(`/p/${profile.slug}/transactions`);
            }}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-badge border border-border-hairline text-text-secondary">
              <ProfileIcon profile={profile} className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-secondary text-text-primary">{profile.label}</span>
              <span className="text-caption text-text-muted">
                {t(`subtitle.${SUBTITLE_KEY[profile.subtitle]}`)}
              </span>
            </span>
            {profile.slug === activeProfile.slug && (
              <CheckIcon className="ml-auto size-4 shrink-0" {...ICON_PROPS} />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * EN/RO segmented toggle (i18n Stage 1). Persists the choice via a
 * cookie-setting server action, then refreshes so server components
 * re-render in the new locale.
 */
function LocaleToggle() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("sidebar");
  const [isPending, startTransition] = React.useTransition();

  return (
    <div role="group" aria-label={t("language")} className="ml-auto flex shrink-0 gap-1">
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          disabled={isPending}
          aria-pressed={code === locale}
          className={cn(
            "rounded-badge px-1.5 py-1 text-caption uppercase outline-none focus-visible:ring-3 focus-visible:ring-focus-ring",
            code === locale
              ? "bg-accent text-accent-foreground"
              : "text-text-muted hover:bg-surface-inactive",
          )}
          onClick={() => {
            if (code === locale) return;
            startTransition(async () => {
              await setLocaleAction(code);
              router.refresh();
            });
          }}
        >
          {code}
        </button>
      ))}
    </div>
  );
}

export function AppSidebar({ activeProfileSlug }: { activeProfileSlug: string }) {
  const pathname = usePathname();
  const t = useTranslations("sidebar");
  const tCommon = useTranslations("common");
  const activeProfile = getProfile(activeProfileSlug) ?? PROFILES[0];
  const base = `/p/${activeProfile.slug}`;

  const views = [
    { href: `${base}/transactions`, label: t("transactions"), icon: ReceiptIcon },
    { href: `${base}/dashboard`, label: t("dashboard"), icon: LayoutDashboardIcon },
    { href: `${base}/manage`, label: t("manage"), icon: Settings2Icon },
    { href: "/roadmap", label: t("roadmap"), icon: MapIcon },
  ];
  const flows = [
    { href: `${base}/transactions?entry=salary`, label: t("newSalary"), icon: BanknoteIcon },
    { href: `${base}/flows/dividend`, label: t("newDividend"), icon: CoinsIcon },
    { href: `${base}/imports`, label: t("importStatement"), icon: ImportIcon },
  ];
  const investments = [
    { href: `${base}/investments`, label: t("recordTrade"), icon: TrendingUpIcon },
    ...(activeProfile.owner === "greg"
      ? [{ href: `${base}/imports`, label: t("importBrokerage"), icon: ImportIcon }]
      : []),
  ];

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-border-hairline">
        <SidebarMenu>
          <SidebarMenuItem>
            <ProfileSwitcher activeProfile={activeProfile} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("views")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {views.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={pathname.startsWith(item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon {...ICON_PROPS} />
                    {item.label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {activeProfile.companyFlows && (
          <SidebarGroup>
            <SidebarGroupLabel>{t("flows")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {flows.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={pathname.startsWith(item.href)}
                      render={<Link href={item.href} />}
                    >
                      <item.icon {...ICON_PROPS} />
                      {item.label}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {activeProfile.investments && (
          <SidebarGroup>
            <SidebarGroupLabel>{tCommon("investments")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {investments.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={pathname.startsWith(item.href)}
                      render={<Link href={item.href} />}
                    >
                      <item.icon {...ICON_PROPS} />
                      {item.label}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-border-hairline">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Avatar className="size-8">
            <AvatarFallback>G</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-secondary text-text-primary">Greg</span>
            <span className="text-caption text-text-muted">{tCommon("appName")}</span>
          </span>
          <LocaleToggle />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
