import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ManagementClient } from "@/components/management/management-client";
import { listManagedCategories, listManagedEmployees } from "@/lib/management/service";
import { getProfile } from "@/lib/profiles";

export const dynamic = "force-dynamic";

export default async function ManagePage({
  params,
}: {
  params: Promise<{ profile: string }>;
}) {
  const { profile: slug } = await params;
  const profile = getProfile(slug);
  if (!profile) notFound();
  const t = await getTranslations("manage");
  const [categories, employees] = await Promise.all([
    listManagedCategories(profile.entityId),
    profile.companyFlows ? listManagedEmployees(profile.entityId) : Promise.resolve([]),
  ]);

  return (
    <div className="density-compact flex max-w-6xl flex-col gap-[var(--density-section-gap)]">
      <h1 className="text-title text-text-primary">{t("title")}</h1>
      <ManagementClient
        profileSlug={profile.slug}
        entityId={profile.entityId}
        company={profile.companyFlows}
        categories={categories}
        employees={employees}
      />
    </div>
  );
}
