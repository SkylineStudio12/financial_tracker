import { redirect } from "next/navigation";

/**
 * The New Transaction page was replaced by a modal on the transaction list
 * (phase 2.6). Old bookmarks and browser history land here — send them to
 * the list, where the "New transaction" button opens the modal.
 */
export default async function LegacyNewTransactionPage({
  params,
}: {
  params: Promise<{ profile: string }>;
}) {
  const { profile } = await params;
  redirect(`/p/${profile}/transactions`);
}
