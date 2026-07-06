import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getProfile } from "@/lib/profiles";

export const dynamic = "force-dynamic";

export default async function ProfileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ profile: string }>;
}) {
  const { profile: slug } = await params;
  if (!getProfile(slug)) notFound();

  return (
    <SidebarProvider>
      <AppSidebar activeProfileSlug={slug} />
      <SidebarInset className="min-w-0 p-[var(--density-card-padding)]">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
