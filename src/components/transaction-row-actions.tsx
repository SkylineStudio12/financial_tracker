"use client";

import { useRef, useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  deleteTransactionAction,
  loadTransactionEditDraftAction,
} from "@/lib/ledger/actions";
import type { TransactionEditDraft } from "@/lib/ledger/edit-drafts";
import type { AppError } from "@/lib/app-error";
import { useTranslatedError } from "@/components/use-translated-error";
import { StandardForm } from "@/components/forms/standard-form";
import { TransferForm } from "@/components/forms/transfer-form";
import { OpeningBalanceForm } from "@/components/forms/opening-balance-form";
import { SalaryFlow } from "@/components/flows/salary-flow";
import { DividendFlow } from "@/components/flows/dividend-flow";
import type { AccountOption, FormOptions } from "@/components/forms/option-types";
import type { EmployeeOption } from "@/lib/management/service";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ICON_PROPS = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

export function TransactionRowActions({
  transactionId,
  entityId,
  profileSlug,
  crudAvailable,
  importBatchId,
  importSourceLabel,
  options,
}: {
  transactionId: string;
  entityId: string;
  profileSlug: string;
  crudAvailable: boolean;
  importBatchId: string | null;
  importSourceLabel: string | null;
  options: FormOptions;
}) {
  const t = useTranslations("transactions");
  const translateError = useTranslatedError();
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draft, setDraft] = useState<TransactionEditDraft | null>(null);
  const [personalAccounts, setPersonalAccounts] = useState<AccountOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [pending, startTransition] = useTransition();
  const refreshAfterClose = useRef(false);

  const loadEdit = () => {
    if (!crudAvailable) return;
    setEditOpen(true);
    setError(null);
    startTransition(async () => {
      const result = await loadTransactionEditDraftAction(
        transactionId,
        entityId,
        profileSlug,
      );
      if (result?.error) setError(result.error);
      else {
        if (!result?.draft || !result.personalAccounts || !result.employees) return;
        setDraft(result.draft);
        setPersonalAccounts(result.personalAccounts);
        setEmployees(result.employees);
      }
    });
  };

  const saved = () => {
    refreshAfterClose.current = true;
    setEditOpen(false);
    setDraft(null);
  };
  const cancelSlot = (
    <DialogClose render={<Button variant="secondary" />}>{t("cancel")}</DialogClose>
  );

  const editButton = (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      disabled={!crudAvailable || pending}
      aria-label={crudAvailable ? t("edit") : t("investmentUnavailable")}
      onClick={loadEdit}
    >
      <Pencil {...ICON_PROPS} />
    </Button>
  );
  const deleteButton = (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      disabled={!crudAvailable || pending}
      aria-label={crudAvailable ? t("delete") : t("investmentUnavailable")}
      onClick={() => crudAvailable && setDeleteOpen(true)}
    >
      <Trash2 {...ICON_PROPS} />
    </Button>
  );

  return (
    <div
      className="flex items-center justify-end gap-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>{editButton}</TooltipTrigger>
        <TooltipContent>{crudAvailable ? t("edit") : t("investmentUnavailable")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>{deleteButton}</TooltipTrigger>
        <TooltipContent>{crudAvailable ? t("delete") : t("investmentUnavailable")}</TooltipContent>
      </Tooltip>

      <Dialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onOpenChangeComplete={(open) => {
          if (!open && refreshAfterClose.current) {
            refreshAfterClose.current = false;
            router.refresh();
          }
        }}
      >
        <DialogContent className="density-compact max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{t("editTransaction")}</DialogTitle>
              {draft && draft.bookingEntityId !== entityId && (
                <Badge variant="secondary">
                  {t("bookingEntity", { entity: draft.bookingEntityName })}
                </Badge>
              )}
            </div>
          </DialogHeader>
          {pending && !draft && <p className="text-secondary text-text-muted">{t("loading")}</p>}
          {error && <p className="text-secondary text-status-negative-text">{translateError(error)}</p>}
          {draft?.type === "standard" && (
            <StandardForm
              entityId={draft.bookingEntityId}
              profileSlug={profileSlug}
              options={options}
              initial={draft}
              stay
              onSaved={saved}
              cancelSlot={cancelSlot}
            />
          )}
          {draft?.type === "transfer" && (
            <TransferForm
              entityId={draft.bookingEntityId}
              profileSlug={profileSlug}
              options={options}
              initial={draft}
              stay
              onSaved={saved}
              cancelSlot={cancelSlot}
            />
          )}
          {draft?.type === "opening_balance" && (
            <OpeningBalanceForm
              entityId={draft.bookingEntityId}
              options={options}
              initial={draft}
              onSaved={saved}
              cancelSlot={cancelSlot}
            />
          )}
          {draft?.type === "salary" && (
            <SalaryFlow
              companyId={draft.bookingEntityId}
              personalAccounts={personalAccounts}
              employees={employees}
              initial={draft}
              onSaved={saved}
              cancelSlot={cancelSlot}
            />
          )}
          {draft?.type === "dividend" && (
            <DividendFlow
              companyId={draft.bookingEntityId}
              personalAccounts={personalAccounts}
              initial={draft}
              onSaved={saved}
              cancelSlot={cancelSlot}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {importBatchId
                ? t("deleteImportedBody", {
                    batch: importSourceLabel ?? importBatchId,
                  })
                : t("deleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-secondary text-status-negative-text">{translateError(error)}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await deleteTransactionAction(
                    transactionId,
                    entityId,
                    profileSlug,
                    true,
                  );
                  if (result && "error" in result) setError(result.error);
                  else {
                    setDeleteOpen(false);
                    router.refresh();
                  }
                });
              }}
            >
              {pending ? t("deleting") : t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
