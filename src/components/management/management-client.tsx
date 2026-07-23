"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { Pencil, Plus, RotateCcw, Trash2, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime, formatMinor, minorToInput, parseAmountToMinor } from "@/lib/format";
import type { AppError } from "@/lib/app-error";
import {
  createCategoryAction,
  createEmployeeAction,
  createManagedAccountAction,
  deleteCategoryAction,
  deleteEmployeeAction,
  deleteManagedAccountAction,
  deleteSalaryProfileAction,
  purgeCategoryAction,
  purgeManagedAccountAction,
  restoreCategoryAction,
  restoreEmployeeAction,
  restoreManagedAccountAction,
  updateCategoryAction,
  updateEmployeeDetailsAction,
  updateManagedAccountAction,
  type ActionResult,
} from "@/lib/management/actions";
import type {
  ManagedCategory,
  ManagedAccount,
  ManagedEmployee,
  SalaryProfileValues,
} from "@/lib/management/service";
import { useTranslatedError } from "@/components/use-translated-error";
import { errorClass, fieldClass, labelClass, moneyFieldClass } from "@/components/forms/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CategoryLabel } from "@/components/category-label";
import { CategoryIconPicker } from "@/components/management/category-icon-picker";
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
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ICON_PROPS = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

type DialogMode =
  | { type: "account-create" }
  | { type: "account-edit"; account: ManagedAccount }
  | { type: "category-create" }
  | { type: "category-edit"; category: ManagedCategory }
  | { type: "employee-create" }
  | { type: "employee-edit"; employee: ManagedEmployee };

type DeleteTarget =
  | { type: "account"; id: string; name: string }
  | { type: "category"; id: string; name: string }
  | { type: "employee"; id: string; name: string }
  | { type: "profile"; id: string; name: string };

type RecoveryTarget = { type: "account" | "category" | "employee"; id: string; name: string };

interface FormFields {
  name: string;
  kind: "income" | "expense";
  parentId: string;
  icon: string;
  isActive: boolean;
  accountType: "bank" | "cash";
  currency: "RON" | "EUR" | "USD";
  owner: "greg" | "andra" | "";
  gross: string;
  cas: string;
  cass: string;
  incomeTax: string;
  cam: string;
  net: string;
  personalDeduction: string;
}

const emptyFields: FormFields = {
  name: "",
  kind: "expense",
  parentId: "",
  icon: "",
  isActive: true,
  accountType: "bank",
  currency: "RON",
  owner: "",
  gross: "",
  cas: "",
  cass: "",
  incomeTax: "",
  cam: "",
  net: "",
  personalDeduction: "",
};

function profileFields(employee: ManagedEmployee): FormFields {
  const profile = employee.profile;
  return {
    ...emptyFields,
    name: employee.name,
    isActive: employee.isActive,
    gross: profile ? minorToInput(profile.grossMinor) : "",
    cas: profile ? minorToInput(profile.casMinor) : "",
    cass: profile ? minorToInput(profile.cassMinor) : "",
    incomeTax: profile ? minorToInput(profile.incomeTaxMinor) : "",
    cam: profile ? minorToInput(profile.camMinor) : "",
    net: profile ? minorToInput(profile.netMinor) : "",
    personalDeduction: profile ? minorToInput(profile.personalDeductionMinor) : "",
  };
}

export function ManagementClient({
  profileSlug,
  entityId,
  company,
  accounts,
  deletedAccounts,
  categories,
  deletedCategories,
  employees,
  deletedEmployees,
}: {
  profileSlug: string;
  entityId: string;
  company: boolean;
  accounts: ManagedAccount[];
  deletedAccounts: ManagedAccount[];
  categories: ManagedCategory[];
  deletedCategories: ManagedCategory[];
  employees: ManagedEmployee[];
  deletedEmployees: ManagedEmployee[];
}) {
  const t = useTranslations("manage");
  const labels = useTranslations("enums");
  const locale = useLocale();
  const translateError = useTranslatedError();
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [fields, setFields] = useState<FormFields>(emptyFields);
  const [initialFields, setInitialFields] = useState(JSON.stringify(emptyFields));
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<RecoveryTarget | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [pending, startTransition] = useTransition();
  const refreshAfterClose = useRef(false);
  const dirty = JSON.stringify(fields) !== initialFields;

  const ownParents = useMemo(
    () => categories.filter((category) => !category.shared && category.parentId === null),
    [categories],
  );
  const orderedCategories = useMemo(() => {
    const ordered: ManagedCategory[] = [];
    const included = new Set<string>();
    for (const kind of ["income", "expense"] as const) {
      for (const root of categories.filter(
        (category) => category.kind === kind && category.parentId === null,
      )) {
        ordered.push(root);
        included.add(root.id);
        for (const child of categories.filter((category) => category.parentId === root.id)) {
          ordered.push(child);
          included.add(child.id);
        }
      }
    }
    ordered.push(...categories.filter((category) => !included.has(category.id)));
    return ordered;
  }, [categories]);
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const orderedAccounts = useMemo(
    () => [...accounts].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)),
    [accounts],
  );

  const openDialog = (next: DialogMode) => {
    let nextFields = emptyFields;
    if (next.type === "account-edit") {
      nextFields = {
        ...emptyFields,
        name: next.account.name,
        accountType: next.account.type === "cash" ? "cash" : "bank",
        currency: next.account.currency,
        owner: next.account.owner ?? "",
        isActive: next.account.isActive,
      };
    } else if (next.type === "category-edit") {
      nextFields = {
        ...emptyFields,
        name: next.category.name,
        kind: next.category.kind,
        parentId: next.category.parentId ?? "",
        icon: next.category.icon ?? "",
      };
    } else if (next.type === "employee-edit") {
      nextFields = profileFields(next.employee);
    }
    setFields(nextFields);
    setInitialFields(JSON.stringify(nextFields));
    setError(null);
    setDialog(next);
  };

  const closeDialog = () => {
    setError(null);
    setDialog(null);
  };

  const saved = () => {
    refreshAfterClose.current = true;
    setDialog(null);
  };

  const submit = () => {
    if (!dialog) return;
    startTransition(async () => {
      let result: ActionResult<unknown>;
      if (dialog.type === "account-create" || dialog.type === "account-edit") {
        const values = {
          name: fields.name,
          type: fields.accountType,
          currency: fields.currency,
          owner: company ? null : fields.owner || null,
          isActive: fields.isActive,
        } as const;
        result =
          dialog.type === "account-create"
            ? await createManagedAccountAction(profileSlug, entityId, values)
            : await updateManagedAccountAction(profileSlug, entityId, dialog.account.id, values);
      } else if (dialog.type === "category-create") {
        result = await createCategoryAction(profileSlug, {
          entityId,
          name: fields.name,
          kind: fields.kind,
          parentId: fields.parentId || null,
          icon: fields.icon || null,
        });
      } else if (dialog.type === "category-edit") {
        result = await updateCategoryAction(profileSlug, entityId, dialog.category.id, {
          name: fields.name,
          kind: fields.kind,
          icon: fields.icon || null,
        });
      } else if (dialog.type === "employee-create") {
        result = await createEmployeeAction(profileSlug, entityId, fields.name);
      } else if (dialog.type === "employee-edit") {
        const salaryFields = [
          fields.gross,
          fields.cas,
          fields.cass,
          fields.incomeTax,
          fields.cam,
          fields.net,
          fields.personalDeduction,
        ];
        const hasSalaryProfile = salaryFields.some((value) => value.trim() !== "");
        const values = hasSalaryProfile ? {
          grossMinor: parseAmountToMinor(fields.gross),
          casMinor: parseAmountToMinor(fields.cas),
          cassMinor: parseAmountToMinor(fields.cass),
          incomeTaxMinor: parseAmountToMinor(fields.incomeTax),
          camMinor: parseAmountToMinor(fields.cam),
          netMinor: parseAmountToMinor(fields.net),
          personalDeductionMinor: parseAmountToMinor(fields.personalDeduction),
        } : null;
        if (values && Object.values(values).some((value) => value === null)) return;
        result = await updateEmployeeDetailsAction(
          profileSlug,
          entityId,
          dialog.employee.id,
          { name: fields.name, isActive: fields.isActive },
          values as SalaryProfileValues | null,
        );
      } else {
        return;
      }
      if ("error" in result) setError(result.error);
      else saved();
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result =
        deleteTarget.type === "account"
          ? await deleteManagedAccountAction(profileSlug, entityId, deleteTarget.id)
          : deleteTarget.type === "category"
          ? await deleteCategoryAction(profileSlug, entityId, deleteTarget.id)
          : deleteTarget.type === "employee"
            ? await deleteEmployeeAction(profileSlug, entityId, deleteTarget.id)
            : await deleteSalaryProfileAction(profileSlug, entityId, deleteTarget.id);
      if ("error" in result) setError(result.error);
      else {
        setError(null);
        setDeleteTarget(null);
        router.refresh();
      }
    });
  };

  const restore = (target: RecoveryTarget) => {
    startTransition(async () => {
      const result =
        target.type === "account"
          ? await restoreManagedAccountAction(profileSlug, entityId, target.id)
          : target.type === "category"
            ? await restoreCategoryAction(profileSlug, entityId, target.id)
            : await restoreEmployeeAction(profileSlug, entityId, target.id);
      if ("error" in result) setError(result.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  };

  const confirmPurge = () => {
    if (!purgeTarget) return;
    startTransition(async () => {
      const result =
        purgeTarget.type === "account"
          ? await purgeManagedAccountAction(profileSlug, entityId, purgeTarget.id)
          : await purgeCategoryAction(profileSlug, entityId, purgeTarget.id);
      if ("error" in result) setError(result.error);
      else {
        setError(null);
        setPurgeTarget(null);
        router.refresh();
      }
    });
  };

  const deactivateDeleteTarget = () => {
    if (deleteTarget?.type !== "account") return;
    const account = accounts.find((candidate) => candidate.id === deleteTarget.id);
    if (!account || (account.type !== "bank" && account.type !== "cash")) return;
    const accountType = account.type;
    startTransition(async () => {
      const result = await updateManagedAccountAction(profileSlug, entityId, account.id, {
        name: account.name,
        type: accountType,
        currency: account.currency,
        owner: account.owner,
        isActive: false,
      });
      if ("error" in result) setError(result.error);
      else {
        setError(null);
        setDeleteTarget(null);
        router.refresh();
      }
    });
  };

  const title =
    dialog?.type === "account-create"
      ? t("accountCreate")
      : dialog?.type === "account-edit"
        ? t("accountEdit")
        : dialog?.type === "category-create"
          ? t("categoryCreate")
          : dialog?.type === "category-edit"
            ? t("categoryEdit")
            : dialog?.type === "employee-create"
              ? t("employeeCreate")
              : t("employeeEdit");
  const editingAccount = dialog?.type === "account-edit" ? dialog.account : null;
  const accountShapeLocked = Boolean(editingAccount && editingAccount.postingCount > 0);
  const accountOwnerMissing =
    !company &&
    (dialog?.type === "account-create" || dialog?.type === "account-edit") &&
    fields.owner === "";

  return (
    <>
      {error && !dialog && !deleteTarget && !purgeTarget && (
        <p className={errorClass}>{translateError(error)}</p>
      )}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-card-title text-text-primary">{t("accountsTitle")}</h2>
            <p className="text-caption text-text-muted">{t("accountsIntro")}</p>
          </div>
          <Button size="sm" onClick={() => openDialog({ type: "account-create" })}>
            <Plus {...ICON_PROPS} />
            {t("accountAdd")}
          </Button>
        </div>
        {orderedAccounts.length === 0 ? (
          <div className="flex min-h-32 flex-col items-center justify-center gap-2 border border-border-hairline bg-surface px-4 py-6 text-center">
            <Wallet {...ICON_PROPS} className="size-5 text-text-muted" />
            <p className="text-secondary text-text-primary">{t("accountsEmpty")}</p>
            <Button size="sm" onClick={() => openDialog({ type: "account-create" })}>
              <Plus {...ICON_PROPS} />
              {t("accountAdd")}
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden border border-border-hairline bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>{t("type")}</TableHead>
                  <TableHead>{t("currency")}</TableHead>
                  {!company && <TableHead>{t("owner")}</TableHead>}
                  <TableHead className="text-right">{t("balanceRon")}</TableHead>
                  <TableHead className="text-right">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderedAccounts.map((account, index) => (
                  <Fragment key={account.id}>
                    {!account.isActive &&
                      (index === 0 || orderedAccounts[index - 1]?.isActive) && (
                        <TableRow>
                          <TableCell
                            colSpan={company ? 5 : 6}
                            className="text-caption font-medium uppercase text-text-muted"
                          >
                            {t("inactive")}
                          </TableCell>
                        </TableRow>
                      )}
                    <TableRow className={account.isActive ? undefined : "text-text-muted"}>
                      <TableCell>{account.name}</TableCell>
                      <TableCell>{labels(`accountType.${account.type}`)}</TableCell>
                      <TableCell>{account.currency}</TableCell>
                      {!company && (
                        <TableCell>{account.owner ? t(`owners.${account.owner}`) : "-"}</TableCell>
                      )}
                      <TableCell
                        className={`text-right font-numeric tabular-nums ${
                          account.balanceRon < 0 ? "text-status-negative-text" : "text-text-primary"
                        }`}
                      >
                        {formatMinor(account.balanceRon, "RON", locale)}
                      </TableCell>
                      <TableCell>
                        <span className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            disabled={account.readOnly}
                            aria-label={t("edit")}
                            title={account.readOnly ? t("brokerageManaged") : undefined}
                            onClick={() => openDialog({ type: "account-edit", account })}
                          >
                            <Pencil {...ICON_PROPS} />
                          </Button>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            disabled={account.readOnly}
                            aria-label={t("delete")}
                            title={account.readOnly ? t("brokerageManaged") : undefined}
                            onClick={() =>
                              setDeleteTarget({ type: "account", id: account.id, name: account.name })
                            }
                          >
                            <Trash2 {...ICON_PROPS} />
                          </Button>
                        </span>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {deletedAccounts.length > 0 && (
          <details className="border-t border-border-hairline pt-2">
            <summary className="cursor-pointer text-secondary text-text-primary outline-none focus-visible:ring-3 focus-visible:ring-focus-ring">
              {t("deletedAccounts", { count: deletedAccounts.length })}
            </summary>
            <div className="mt-2 overflow-hidden border border-border-hairline bg-surface">
              <Table>
                <TableBody>
                  {deletedAccounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell>{account.name}</TableCell>
                      <TableCell>{labels(`accountType.${account.type}`)}</TableCell>
                      <TableCell className="text-text-muted">
                        {formatDateTime(account.deletedAt!, locale)}
                      </TableCell>
                      <TableCell>
                        <span className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() =>
                              restore({ type: "account", id: account.id, name: account.name })
                            }
                          >
                            <RotateCcw {...ICON_PROPS} />
                            {t("restore")}
                          </Button>
                          {account.postingCount === 0 && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-status-negative-text"
                              onClick={() =>
                                setPurgeTarget({
                                  type: "account",
                                  id: account.id,
                                  name: account.name,
                                })
                              }
                            >
                              <Trash2 {...ICON_PROPS} />
                              {t("purge")}
                            </Button>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        )}
        <p className="text-caption text-text-muted">{t("systemAccountsCaption")}</p>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-card-title text-text-primary">{t("categoriesTitle")}</h2>
            <p className="text-caption text-text-muted">{t("categoriesIntro")}</p>
          </div>
          <Button size="sm" onClick={() => openDialog({ type: "category-create" })}>
            <Plus {...ICON_PROPS} />
            {t("categoryAdd")}
          </Button>
        </div>
        <div className="overflow-hidden rounded-card border border-border-hairline bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("kind")}</TableHead>
                <TableHead>{t("parent")}</TableHead>
                <TableHead>{t("inUse")}</TableHead>
                <TableHead className="text-right">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderedCategories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell>
                    <span className={`flex items-center gap-2 ${category.parentId ? "pl-4" : ""}`}>
                      <CategoryLabel
                        name={category.name}
                        icon={category.icon}
                        deleted={false}
                        deletedTooltip={t("deletedCategoryTooltip")}
                      />
                      {category.shared && <Badge variant="secondary">{t("shared")}</Badge>}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(category.kind)}</Badge>
                  </TableCell>
                  <TableCell>{category.parentId ? categoryNames.get(category.parentId) : "-"}</TableCell>
                  <TableCell>{category.inUseCount}</TableCell>
                  <TableCell>
                    <span className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={category.shared}
                        aria-label={t("edit")}
                        onClick={() => openDialog({ type: "category-edit", category })}
                      >
                        <Pencil {...ICON_PROPS} />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={category.shared}
                        aria-label={t("delete")}
                        onClick={() =>
                          setDeleteTarget({ type: "category", id: category.id, name: category.name })
                        }
                      >
                        <Trash2 {...ICON_PROPS} />
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {deletedCategories.length > 0 && (
          <details className="border-t border-border-hairline pt-2">
            <summary className="cursor-pointer text-secondary text-text-primary outline-none focus-visible:ring-3 focus-visible:ring-focus-ring">
              {t("deletedCategories", { count: deletedCategories.length })}
            </summary>
            <div className="mt-2 overflow-hidden border border-border-hairline bg-surface">
              <Table>
                <TableBody>
                  {deletedCategories.map((category) => (
                    <TableRow key={category.id}>
                      <TableCell>{category.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{t(category.kind)}</Badge>
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {formatDateTime(category.deletedAt!, locale)}
                      </TableCell>
                      <TableCell>
                        <span className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() =>
                              restore({ type: "category", id: category.id, name: category.name })
                            }
                          >
                            <RotateCcw {...ICON_PROPS} />
                            {t("restore")}
                          </Button>
                          {category.postingCount === 0 && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-status-negative-text"
                              onClick={() =>
                                setPurgeTarget({
                                  type: "category",
                                  id: category.id,
                                  name: category.name,
                                })
                              }
                            >
                              <Trash2 {...ICON_PROPS} />
                              {t("purge")}
                            </Button>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        )}
      </section>

      {company && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-card-title text-text-primary">{t("employeesTitle")}</h2>
              <p className="text-caption text-text-muted">{t("employeesIntro")}</p>
            </div>
            <Button size="sm" onClick={() => openDialog({ type: "employee-create" })}>
              <Plus {...ICON_PROPS} />
              {t("employeeAdd")}
            </Button>
          </div>
          <div className="overflow-hidden rounded-card border border-border-hairline bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead>{t("salaryProfile")}</TableHead>
                  <TableHead className="text-right">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-text-muted">
                      {t("employeesEmpty")}
                    </TableCell>
                  </TableRow>
                )}
                {employees.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell>{employee.name}</TableCell>
                    <TableCell>
                      <Badge variant={employee.isActive ? "default" : "secondary"}>
                        {employee.isActive ? t("active") : t("inactive")}
                      </Badge>
                    </TableCell>
                    <TableCell>{employee.profile ? t("profileReady") : t("profileMissing")}</TableCell>
                    <TableCell>
                      <span className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("edit")}
                          onClick={() => openDialog({ type: "employee-edit", employee })}
                        >
                          <Pencil {...ICON_PROPS} />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("delete")}
                          onClick={() =>
                            setDeleteTarget({ type: "employee", id: employee.id, name: employee.name })
                          }
                        >
                          <Trash2 {...ICON_PROPS} />
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {deletedEmployees.length > 0 && (
            <details className="border-t border-border-hairline pt-2">
              <summary className="cursor-pointer text-secondary text-text-primary outline-none focus-visible:ring-3 focus-visible:ring-focus-ring">
                {t("deletedEmployees", { count: deletedEmployees.length })}
              </summary>
              <div className="mt-2 overflow-hidden border border-border-hairline bg-surface">
                <Table>
                  <TableBody>
                    {deletedEmployees.map((employee) => (
                      <TableRow key={employee.id}>
                        <TableCell>{employee.name}</TableCell>
                        <TableCell>
                          {employee.profile ? t("profileReady") : t("profileMissing")}
                        </TableCell>
                        <TableCell className="text-text-muted">
                          {formatDateTime(employee.deletedAt!, locale)}
                        </TableCell>
                        <TableCell>
                          <span className="flex justify-end">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() =>
                                restore({
                                  type: "employee",
                                  id: employee.id,
                                  name: employee.name,
                                })
                              }
                            >
                              <RotateCcw {...ICON_PROPS} />
                              {t("restore")}
                            </Button>
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          )}
        </section>
      )}

      <Dialog
        open={dialog !== null}
        onOpenChange={(open, details) => {
          if (!open && dirty && (details.reason === "escape-key" || details.reason === "outside-press")) {
            setConfirmDiscard(true);
            return;
          }
          if (!open) closeDialog();
        }}
        onOpenChangeComplete={(open) => {
          if (!open && refreshAfterClose.current) {
            refreshAfterClose.current = false;
            router.refresh();
          }
        }}
      >
        <DialogContent className="density-compact max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {(dialog?.type === "account-create" || dialog?.type === "account-edit") && (
              <>
                <label className={labelClass}>
                  {t("name")}
                  <input
                    className={fieldClass}
                    value={fields.name}
                    onChange={(event) => setFields({ ...fields, name: event.target.value })}
                  />
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className={labelClass}>
                    {t("type")}
                    <select
                      className={fieldClass}
                      value={fields.accountType}
                      disabled={accountShapeLocked}
                      onChange={(event) =>
                        setFields({
                          ...fields,
                          accountType: event.target.value as "bank" | "cash",
                        })
                      }
                    >
                      <option value="bank">{labels("accountType.bank")}</option>
                      <option value="cash">{labels("accountType.cash")}</option>
                    </select>
                  </label>
                  <label className={labelClass}>
                    {t("currency")}
                    <select
                      className={fieldClass}
                      value={fields.currency}
                      disabled={accountShapeLocked}
                      onChange={(event) =>
                        setFields({
                          ...fields,
                          currency: event.target.value as "RON" | "EUR" | "USD",
                        })
                      }
                    >
                      {(["RON", "EUR", "USD"] as const).map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {!company && (
                  <fieldset className={labelClass} disabled={accountShapeLocked}>
                    <legend>{t("owner")}</legend>
                    <div className="flex gap-4">
                      {(["greg", "andra"] as const).map((owner) => (
                        <label key={owner} className="flex items-center gap-2 text-secondary text-text-primary">
                          <input
                            type="radio"
                            name="account-owner"
                            value={owner}
                            checked={fields.owner === owner}
                            onChange={() => setFields({ ...fields, owner })}
                          />
                          {t(`owners.${owner}`)}
                        </label>
                      ))}
                    </div>
                    <span className="text-caption text-text-muted">{t("ownerRequiredNote")}</span>
                  </fieldset>
                )}
                {accountShapeLocked && (
                  <p className="text-caption text-text-muted">{t("accountShapeLocked")}</p>
                )}
                <label className="flex items-center gap-2 text-secondary text-text-primary">
                  <Checkbox
                    checked={fields.isActive}
                    onCheckedChange={(checked) =>
                      setFields({ ...fields, isActive: checked === true })
                    }
                  />
                  {t("active")}
                </label>
              </>
            )}
            {(dialog?.type === "category-create" || dialog?.type === "category-edit") && (
              <>
                <label className={labelClass}>
                  {t("name")}
                  <input
                    className={fieldClass}
                    value={fields.name}
                    onChange={(event) => setFields({ ...fields, name: event.target.value })}
                  />
                </label>
                <label className={labelClass}>
                  {t("kind")}
                  <select
                    className={fieldClass}
                    value={fields.kind}
                    disabled={dialog.type === "category-edit"}
                    onChange={(event) =>
                      setFields({ ...fields, kind: event.target.value as "income" | "expense" })
                    }
                  >
                    <option value="income">{t("income")}</option>
                    <option value="expense">{t("expense")}</option>
                  </select>
                </label>
                <div className={labelClass}>
                  <span>{t("icon")}</span>
                  <CategoryIconPicker
                    value={fields.icon}
                    onChange={(icon) => setFields({ ...fields, icon })}
                  />
                </div>
                {dialog.type === "category-create" && (
                  <label className={labelClass}>
                    {t("parent")}
                    <select
                      className={fieldClass}
                      value={fields.parentId}
                      onChange={(event) => setFields({ ...fields, parentId: event.target.value })}
                    >
                      <option value="">{t("noParent")}</option>
                      {ownParents.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {(dialog?.type === "employee-create" || dialog?.type === "employee-edit") && (
              <>
                <label className={labelClass}>
                  {t("name")}
                  <input
                    className={fieldClass}
                    value={fields.name}
                    onChange={(event) => setFields({ ...fields, name: event.target.value })}
                  />
                </label>
                {dialog.type === "employee-edit" && (
                  <label className="flex items-center gap-2 text-secondary text-text-primary">
                    <Checkbox
                      checked={fields.isActive}
                      onCheckedChange={(checked) =>
                        setFields({ ...fields, isActive: checked === true })
                      }
                    />
                    {t("active")}
                  </label>
                )}
              </>
            )}
            {dialog?.type === "employee-edit" && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {([
                    ["gross", t("gross")],
                    ["cas", t("cas")],
                    ["cass", t("cass")],
                    ["incomeTax", t("incomeTax")],
                    ["cam", t("cam")],
                    ["net", t("net")],
                    ["personalDeduction", t("personalDeduction")],
                  ] as const).map(([key, label]) => (
                    <label key={key} className={labelClass}>
                      {label}
                      <input
                        inputMode="decimal"
                        className={moneyFieldClass}
                        value={fields[key]}
                        onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
                      />
                    </label>
                  ))}
                </div>
                {dialog.employee.profile && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="self-start text-status-negative-text"
                    onClick={() => {
                      const target = {
                        type: "profile" as const,
                        id: dialog.employee.id,
                        name: dialog.employee.name,
                      };
                      closeDialog();
                      setDeleteTarget(target);
                    }}
                  >
                    <Trash2 {...ICON_PROPS} />
                    {t("profileDelete")}
                  </Button>
                )}
              </>
            )}
            {error && <p className={errorClass}>{translateError(error)}</p>}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={closeDialog}>
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={pending || !fields.name.trim() || accountOwnerMissing}
              >
                {pending ? t("working") : t("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? deleteTarget.type === "account"
                  ? t("deleteAccountBody", { name: deleteTarget.name })
                  : deleteTarget.type === "category"
                    ? t("deleteCategoryBody", { name: deleteTarget.name })
                    : t("deleteBody", { name: deleteTarget.name })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className={errorClass}>{translateError(error)}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            {error?.code === "manage.accountInUse" && deleteTarget?.type === "account" ? (
              <AlertDialogAction disabled={pending} onClick={deactivateDeleteTarget}>
                {pending ? t("working") : t("deactivateInstead")}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction variant="destructive" disabled={pending} onClick={confirmDelete}>
                {pending ? t("working") : t("delete")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={purgeTarget !== null} onOpenChange={(open) => !open && setPurgeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("purgeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {purgeTarget ? t("purgeBody", { name: purgeTarget.name }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className={errorClass}>{translateError(error)}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={pending} onClick={confirmPurge}>
              {pending ? t("working") : t("purge")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("discardTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("discardBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("keepEditing")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscard(false);
                closeDialog();
              }}
            >
              {t("discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
