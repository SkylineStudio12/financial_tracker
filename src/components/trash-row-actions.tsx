"use client";

import { useState, useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  checkRestoreCollisionAction,
  purgeTransactionAction,
  restoreTransactionAction,
} from "@/lib/ledger/actions";
import type { AppError } from "@/lib/app-error";
import { useTranslatedError } from "@/components/use-translated-error";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ICON_PROPS = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

export function TrashRowActions({
  transactionId,
  expectedRevision,
  crudAvailable,
}: {
  transactionId: string;
  expectedRevision: number;
  crudAvailable: boolean;
}) {
  const t = useTranslations("transactions");
  const translateError = useTranslatedError();
  const router = useRouter();
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [collision, setCollision] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [pending, startTransition] = useTransition();

  const openRestore = () => {
    if (!crudAvailable) return;
    setError(null);
    startTransition(async () => {
      const result = await checkRestoreCollisionAction(transactionId);
      setCollision(result.collision);
      setRestoreOpen(true);
    });
  };

  const unavailable = (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button size="icon-sm" variant="ghost" disabled aria-label={t("investmentUnavailable")}>
          <RotateCcw {...ICON_PROPS} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("investmentUnavailable")}</TooltipContent>
    </Tooltip>
  );
  if (!crudAvailable) return unavailable;

  return (
    <div className="flex items-center justify-end gap-1">
      <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={openRestore}>
        <RotateCcw {...ICON_PROPS} />
        {t("restore")}
      </Button>
      <Button type="button" size="icon-sm" variant="destructive" disabled={pending} aria-label={t("deletePermanently")} onClick={() => setPurgeOpen(true)}>
        <Trash2 {...ICON_PROPS} />
      </Button>

      <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("restoreTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {collision ? t("possibleDuplicate") : t("restoreBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-secondary text-status-negative-text">{translateError(error)}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await restoreTransactionAction(transactionId, expectedRevision);
                  if ("error" in result) setError(result.error);
                  else {
                    setRestoreOpen(false);
                    router.refresh();
                  }
                })
              }
            >
              {pending ? t("restoring") : t("restore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("purgeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("purgeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-secondary text-status-negative-text">{translateError(error)}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await purgeTransactionAction(transactionId);
                  if ("error" in result) setError(result.error);
                  else {
                    setPurgeOpen(false);
                    router.refresh();
                  }
                })
              }
            >
              {pending ? t("deleting") : t("deletePermanently")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
