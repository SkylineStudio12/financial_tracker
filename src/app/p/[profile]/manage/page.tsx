import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ManagementClient } from "@/components/management/management-client";
import {
  listManagedAccounts,
  listManagedCategories,
  listManagedEmployees,
} from "@/lib/management/service";
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
  const referenceDate = new Date().toISOString().slice(0, 10);
  const [accounts, deletedAccounts, categories, deletedCategories, employees, deletedEmployees] =
    await Promise.all([
      listManagedAccounts(profile.entityId),
      listManagedAccounts(profile.entityId, "deleted"),
      listManagedCategories(profile.entityId),
      listManagedCategories(profile.entityId, "deleted"),
      profile.companyFlows
        ? listManagedEmployees(profile.entityId, referenceDate)
        : Promise.resolve([]),
      profile.companyFlows
        ? listManagedEmployees(profile.entityId, referenceDate, "deleted")
        : Promise.resolve([]),
    ]);

  return (
    <div className="density-compact flex max-w-6xl flex-col gap-[var(--density-section-gap)]">
      <h1 className="text-title text-text-primary">{t("title")}</h1>
      <ManagementClient
        profileSlug={profile.slug}
        entityId={profile.entityId}
        salaryProfileReferenceDate={referenceDate}
        company={profile.companyFlows}
        accounts={accounts}
        deletedAccounts={deletedAccounts}
        categories={categories}
        deletedCategories={deletedCategories}
        employees={employees}
        deletedEmployees={deletedEmployees}
      />
    </div>
  );
}
