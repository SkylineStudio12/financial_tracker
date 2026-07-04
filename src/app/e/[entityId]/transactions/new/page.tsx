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

  const tabOn =
    "inline-flex items-center rounded-input bg-accent text-accent-foreground px-3 h-[var(--density-control-height)] text-secondary";
  const tabOff =
    "inline-flex items-center rounded-input border border-border-input px-3 h-[var(--density-control-height)] text-secondary text-text-muted hover:text-text-primary";

  return (
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)]">
      <h1 className="text-title text-text-primary">New transaction</h1>
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
