"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { XIcon } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StandardForm } from "@/components/forms/standard-form";
import { TransferForm } from "@/components/forms/transfer-form";
import { SalaryFlow } from "@/components/flows/salary-flow";
import type { AccountOption, FormOptions } from "@/components/forms/option-types";
import type { EmployeeOption } from "@/lib/management/service";
import {
  decideEntryTypeChange,
  SEGMENT_GRID_STYLE,
  type EntryType,
} from "@/components/new-transaction-dialog-state";

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
  employees = [],
  salaryAvailable = false,
  initialType,
  databaseBadge,
}: {
  entityId: string;
  /** Active profile view; forwarded to the forms (modal saves stay put). */
  profileSlug?: string;
  options: FormOptions;
  personalAccounts?: AccountOption[];
  employees?: EmployeeOption[];
  salaryAvailable?: boolean;
  initialType?: Extract<EntryType, "salary">;
  databaseBadge?: React.ReactNode;
}) {
  const t = useTranslations("forms");
  const [open, setOpen] = useState(Boolean(initialType));
  const [type, setType] = useState<EntryType>(initialType ?? "standard");
  const [pendingType, setPendingType] = useState<EntryType | null>(null);
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

  const handleTypeChange = (requested: unknown) => {
    const decision = decideEntryTypeChange(type, requested, dirty.current);
    if (decision.kind === "select") {
      dirty.current = false;
      setType(decision.type);
    } else if (decision.kind === "confirm") {
      setPendingType(decision.type);
      setConfirmDiscard(true);
    }
  };

  const handleDiscard = () => {
    // A dirty type switch reuses the same confirmation without closing the modal.
    setConfirmDiscard(false);
    dirty.current = false;
    if (pendingType) {
      setType(pendingType);
      setPendingType(null);
      return;
    }
    // Deliberate close discard bypasses the guard, like a save.
    setOpen(false);
  };

  const handleConfirmDiscardOpenChange = (nextOpen: boolean) => {
    setConfirmDiscard(nextOpen);
    if (!nextOpen) setPendingType(null);
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
      <DialogContent
        className="density-compact max-h-[90vh] overflow-y-auto sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center justify-between">
          <DialogTitle>{t("newTransaction")}</DialogTitle>
          <div className="flex items-center gap-2">
            {databaseBadge}
            <DialogClose render={<Button variant="ghost" size="icon" />}>
              <XIcon absoluteStrokeWidth strokeWidth={1.5} />
              <span className="sr-only">{t("close")}</span>
            </DialogClose>
          </div>
        </DialogHeader>
        <Tabs value={type} onValueChange={handleTypeChange} className="gap-[var(--density-stack-gap)]">
          <TabsList
            activateOnFocus={false}
            loopFocus
            aria-label={t("typeGroupLabel")}
            className="grid h-auto w-full gap-0.5 rounded-input bg-surface-inactive p-1"
            style={SEGMENT_GRID_STYLE}
          >
            <TabsTrigger
              value="standard"
              className="h-7 min-w-0 rounded-badge px-3 py-0 text-secondary font-normal whitespace-normal text-text-secondary shadow-none hover:text-text-primary data-active:bg-accent data-active:text-accent-foreground data-active:hover:bg-accent-hover"
            >
              {t("typeStandard")}
            </TabsTrigger>
            <TabsTrigger
              value="transfer"
              className="h-7 min-w-0 rounded-badge px-3 py-0 text-secondary font-normal whitespace-normal text-text-secondary shadow-none hover:text-text-primary data-active:bg-accent data-active:text-accent-foreground data-active:hover:bg-accent-hover"
            >
              {t("typeTransfer")}
            </TabsTrigger>
            {salaryAvailable && (
              <TabsTrigger
                value="salary"
                className="h-7 min-w-0 rounded-badge px-3 py-0 text-secondary font-normal whitespace-normal text-text-secondary shadow-none hover:text-text-primary data-active:bg-accent data-active:text-accent-foreground data-active:hover:bg-accent-hover"
              >
                {t("typeSalary")}
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="standard">
            <StandardForm
              entityId={entityId}
              profileSlug={profileSlug}
              options={options}
              stay
              onSaved={handleSaved}
              cancelSlot={cancelSlot}
              onDirtyChange={handleDirtyChange}
            />
          </TabsContent>
          <TabsContent value="transfer">
            <TransferForm
              entityId={entityId}
              profileSlug={profileSlug}
              options={options}
              stay
              onSaved={handleSaved}
              cancelSlot={cancelSlot}
              onDirtyChange={handleDirtyChange}
            />
          </TabsContent>
          {salaryAvailable && (
            <TabsContent value="salary">
              <SalaryFlow
                companyId={entityId}
                personalAccounts={personalAccounts}
                employees={employees}
                onSaved={handleSaved}
                cancelSlot={cancelSlot}
                onDirtyChange={handleDirtyChange}
              />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmDiscard} onOpenChange={handleConfirmDiscardOpenChange}>
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
