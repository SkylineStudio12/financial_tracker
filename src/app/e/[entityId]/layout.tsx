import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export const dynamic = "force-dynamic";

export default async function EntityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;

  return (
    <SidebarProvider>
      <AppSidebar activeEntityId={entityId} />
      <SidebarInset className="min-w-0 p-[var(--density-card-padding)]">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
