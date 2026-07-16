import { notFound, redirect } from "next/navigation";
import { getProfile } from "@/lib/profiles";

export const dynamic = "force-dynamic";

export default async function SalaryFlowPage({
  params,
}: {
  params: Promise<{ profile: string }>;
}) {
  const { profile: slug } = await params;
  const profile = getProfile(slug);
  if (!profile || !profile.companyFlows) notFound();
  redirect(`/p/${profile.slug}/transactions?entry=salary`);
}
