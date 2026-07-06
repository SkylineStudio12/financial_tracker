import { notFound, redirect } from "next/navigation";
import { profileForEntity } from "@/lib/profiles";

/**
 * Legacy /e/[entityId] routes (pre-profile, stage 2 and earlier) redirect to
 * the profile-based /p/[profile] equivalents. The Household entity resolves
 * to the shared Household profile; companies to their 1:1 profile.
 */
export default async function LegacyEntityRedirect({
  params,
}: {
  params: Promise<{ entityId: string; rest?: string[] }>;
}) {
  const { entityId, rest } = await params;
  const profile = profileForEntity(entityId);
  if (!profile) notFound();
  const suffix = rest?.length ? rest.join("/") : "transactions";
  redirect(`/p/${profile.slug}/${suffix}`);
}
