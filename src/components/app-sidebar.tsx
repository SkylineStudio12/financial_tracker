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
import {
  BanknoteIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CoinsIcon,
  HouseIcon,
  ImportIcon,
  LayoutDashboardIcon,
  ReceiptIcon,
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
import { getProfile, PROFILES, type Profile } from "@/lib/profiles";

const ICON_PROPS = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<SidebarMenuButton size="lg" aria-label="Switch profile" />}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-badge bg-accent text-accent-foreground">
          <ProfileIcon profile={activeProfile} className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col text-left leading-tight">
          <span className="truncate font-medium text-secondary text-text-primary">
            {activeProfile.label}
          </span>
          <span className="text-caption text-text-muted">{activeProfile.subtitle}</span>
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
              <span className="text-caption text-text-muted">{profile.subtitle}</span>
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

export function AppSidebar({ activeProfileSlug }: { activeProfileSlug: string }) {
  const pathname = usePathname();
  const activeProfile = getProfile(activeProfileSlug) ?? PROFILES[0];
  const base = `/p/${activeProfile.slug}`;

  const views = [
    { href: `${base}/transactions`, label: "Transactions", icon: ReceiptIcon },
    { href: `${base}/dashboard`, label: "Dashboard", icon: LayoutDashboardIcon },
  ];
  const flows = [
    { href: `${base}/flows/salary`, label: "New salary", icon: BanknoteIcon },
    { href: `${base}/flows/dividend`, label: "New dividend", icon: CoinsIcon },
    { href: `${base}/imports`, label: "Import statement", icon: ImportIcon },
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
          <SidebarGroupLabel>Views</SidebarGroupLabel>
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
            <SidebarGroupLabel>Flows</SidebarGroupLabel>
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
      </SidebarContent>

      <SidebarFooter className="border-t border-border-hairline">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Avatar className="size-8">
            <AvatarFallback>G</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-secondary text-text-primary">Greg</span>
            <span className="text-caption text-text-muted">Financial tracker</span>
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
