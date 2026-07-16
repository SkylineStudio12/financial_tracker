"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { StandardForm } from "@/components/forms/standard-form";
import { TransferForm } from "@/components/forms/transfer-form";
import { SalaryFlow } from "@/components/flows/salary-flow";
import type { AccountOption, FormOptions } from "@/components/forms/option-types";

type EntryType = "standard" | "transfer" | "salary";

/**
 * Everyday transaction entry as a modal over the transaction list.
 * Form logic and write-service rules live in the forms/actions — this
 * component only provides the dialog shell, the type switch, and the
 * close-and-refresh on save. Content unmounts on close, so reopening
 * always starts a fresh form without any navigation.
 */
export function NewTransactionDialog({
  entityId,
  profileSlug,
  options,
  personalAccounts = [],
  salaryAvailable = false,
  initialType,
}: {
  entityId: string;
  /** Active profile view; forwarded to the forms (modal saves stay put). */
  profileSlug?: string;
  options: FormOptions;
  personalAccounts?: AccountOption[];
  salaryAvailable?: boolean;
  initialType?: Extract<EntryType, "salary">;
}) {
  const t = useTranslations("forms");
  const tFlows = useTranslations("flows");
  const [open, setOpen] = useState(Boolean(initialType));
  const [type, setType] = useState<EntryType>(initialType ?? "standard");
  // Token-styled discard prompt (replaces window.confirm): an intercepted
  // close parks here until the user picks Discard or Keep editing.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Refresh only after the close animation completes: refreshing in the same
  // batch as setOpen(false) cancels the exit animation and Base UI never
  // finishes unmounting the popup.
  const refreshAfterClose = useRef(false);
  // Unsaved-changes guard: the mounted form reports its dirty state here.
  const dirty = useRef(false);
  const handleDirtyChange = (isDirty: boolean) => {
    dirty.current = isDirty;
  };

  const handleSaved = () => {
    // Saving bypasses the guard: setOpen(false) directly, not via onOpenChange.
    refreshAfterClose.current = true;
    dirty.current = false;
    setOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean, details?: { reason?: string }) => {
    // Escape / overlay-click on a dirtied form must confirm before discarding.
    // Explicit closes (X, Cancel = "close-press") are deliberate and pass.
    if (
      !nextOpen &&
      dirty.current &&
      (details?.reason === "escape-key" || details?.reason === "outside-press")
    ) {
      setConfirmDiscard(true); // intercept: ask first, keep the dialog open
      return;
    }
    if (nextOpen) dirty.current = false; // fresh mount on open
    setOpen(nextOpen);
  };

  const handleDiscard = () => {
    // Deliberate discard bypasses the guard: close directly, like a save.
    setConfirmDiscard(false);
    dirty.current = false;
    setOpen(false);
  };

  const handleOpenChangeComplete = (nowOpen: boolean) => {
    if (nowOpen) return;
    if (initialType) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("entry");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }
    if (!refreshAfterClose.current) return;
    refreshAfterClose.current = false;
    router.refresh();
  };

  const cancelSlot = (
    <DialogClose render={<Button variant="secondary" />}>{t("cancel")}</DialogClose>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange} onOpenChangeComplete={handleOpenChangeComplete}>
      <DialogTrigger render={<Button />}>{t("newTransaction")}</DialogTrigger>
      <DialogContent className="density-compact max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{type === "salary" ? tFlows("salaryTitle") : t("newTransaction")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={type === "standard" ? "default" : "secondary"}
            onClick={() => setType("standard")}
          >
            {t("typeStandard")}
          </Button>
          <Button
            type="button"
            variant={type === "transfer" ? "default" : "secondary"}
            onClick={() => setType("transfer")}
          >
            {t("typeTransfer")}
          </Button>
          {salaryAvailable && (
            <Button
              type="button"
              variant={type === "salary" ? "default" : "secondary"}
              onClick={() => setType("salary")}
            >
              {t("typeSalary")}
            </Button>
          )}
        </div>
        {type === "standard" && (
          <StandardForm
            entityId={entityId}
            profileSlug={profileSlug}
            options={options}
            stay
            onSaved={handleSaved}
            cancelSlot={cancelSlot}
            onDirtyChange={handleDirtyChange}
          />
        )}
        {type === "transfer" && (
          <TransferForm
            entityId={entityId}
            profileSlug={profileSlug}
            options={options}
            stay
            onSaved={handleSaved}
            cancelSlot={cancelSlot}
            onDirtyChange={handleDirtyChange}
          />
        )}
        {type === "salary" && (
          <SalaryFlow
            companyId={entityId}
            personalAccounts={personalAccounts}
            onSaved={handleSaved}
            cancelSlot={cancelSlot}
            onDirtyChange={handleDirtyChange}
          />
        )}
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("discardTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("discardBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("keepEditing")}</AlertDialogCancel>
          <AlertDialogAction onClick={handleDiscard}>{t("discard")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
