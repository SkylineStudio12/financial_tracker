"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import type { FormOptions } from "@/components/forms/option-types";

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
}: {
  entityId: string;
  /** Active profile view; forwarded to the forms (modal saves stay put). */
  profileSlug?: string;
  options: FormOptions;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"standard" | "transfer">("standard");
  // Token-styled discard prompt (replaces window.confirm): an intercepted
  // close parks here until the user picks Discard or Keep editing.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const router = useRouter();
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
    if (!nowOpen && refreshAfterClose.current) {
      refreshAfterClose.current = false;
      router.refresh();
    }
  };

  const cancelSlot = (
    <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange} onOpenChangeComplete={handleOpenChangeComplete}>
      <DialogTrigger render={<Button />}>New transaction</DialogTrigger>
      <DialogContent className="density-compact sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New transaction</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={type === "standard" ? "default" : "secondary"}
            onClick={() => setType("standard")}
          >
            Expense / Income
          </Button>
          <Button
            type="button"
            variant={type === "transfer" ? "default" : "secondary"}
            onClick={() => setType("transfer")}
          >
            Transfer
          </Button>
        </div>
        {type === "standard" ? (
          <StandardForm
            entityId={entityId}
            profileSlug={profileSlug}
            options={options}
            stay
            onSaved={handleSaved}
            cancelSlot={cancelSlot}
            onDirtyChange={handleDirtyChange}
          />
        ) : (
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
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this transaction?</AlertDialogTitle>
          <AlertDialogDescription>
            The details you entered will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={handleDiscard}>Discard</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
