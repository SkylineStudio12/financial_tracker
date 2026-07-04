import Link from "next/link";
import { StandardForm } from "@/components/forms/standard-form";
import { TransferForm } from "@/components/forms/transfer-form";
import { getFormOptions } from "@/lib/ledger/form-options";

export const dynamic = "force-dynamic";

export default async function NewTransactionPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { entityId } = await params;
  const { type } = await searchParams;
  const isTransfer = type === "transfer";
  const options = await getFormOptions(entityId);

  const tabOn = "rounded-md border border-accent bg-surface-raised px-3 py-1.5 text-sm text-fg";
  const tabOff = "rounded-md border border-edge px-3 py-1.5 text-sm text-fg-muted hover:text-fg";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">New transaction</h1>
      <div className="flex gap-2">
        <Link href="?" className={isTransfer ? tabOff : tabOn}>
          Expense / Income
        </Link>
        <Link href="?type=transfer" className={isTransfer ? tabOn : tabOff}>
          Transfer
        </Link>
      </div>
      {isTransfer ? (
        <TransferForm entityId={entityId} options={options} />
      ) : (
        <StandardForm entityId={entityId} options={options} />
      )}
    </div>
  );
}
