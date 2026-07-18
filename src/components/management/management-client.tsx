"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Pencil, Plus, Trash2, WalletCards } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { minorToInput, parseAmountToMinor } from "@/lib/format";
import type { AppError } from "@/lib/app-error";
import {
  createCategoryAction,
  createEmployeeAction,
  deleteCategoryAction,
  deleteEmployeeAction,
  deleteSalaryProfileAction,
  saveSalaryProfileAction,
  updateCategoryAction,
  updateEmployeeAction,
} from "@/lib/management/actions";
import type {
  ManagedCategory,
  ManagedEmployee,
  SalaryProfileValues,
} from "@/lib/management/service";
import { useTranslatedError } from "@/components/use-translated-error";
import { errorClass, fieldClass, labelClass, moneyFieldClass } from "@/components/forms/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  | { type: "category-create" }
  | { type: "category-edit"; category: ManagedCategory }
  | { type: "employee-create" }
  | { type: "employee-edit"; employee: ManagedEmployee }
  | { type: "profile-edit"; employee: ManagedEmployee };

type DeleteTarget =
  | { type: "category"; id: string; name: string }
  | { type: "employee"; id: string; name: string }
  | { type: "profile"; id: string; name: string };

interface FormFields {
  name: string;
  kind: "income" | "expense";
  parentId: string;
  isActive: boolean;
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
  isActive: true,
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
  categories,
  employees,
}: {
  profileSlug: string;
  entityId: string;
  company: boolean;
  categories: ManagedCategory[];
  employees: ManagedEmployee[];
}) {
  const t = useTranslations("manage");
  const translateError = useTranslatedError();
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [fields, setFields] = useState<FormFields>(emptyFields);
  const [initialFields, setInitialFields] = useState(JSON.stringify(emptyFields));
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
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

  const openDialog = (next: DialogMode) => {
    let nextFields = emptyFields;
    if (next.type === "category-edit") {
      nextFields = {
        ...emptyFields,
        name: next.category.name,
        kind: next.category.kind,
        parentId: next.category.parentId ?? "",
      };
    } else if (next.type === "employee-edit") {
      nextFields = { ...emptyFields, name: next.employee.name, isActive: next.employee.isActive };
    } else if (next.type === "profile-edit") {
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
      let result;
      if (dialog.type === "category-create") {
        result = await createCategoryAction(profileSlug, {
          entityId,
          name: fields.name,
          kind: fields.kind,
          parentId: fields.parentId || null,
        });
      } else if (dialog.type === "category-edit") {
        result = await updateCategoryAction(profileSlug, entityId, dialog.category.id, {
          name: fields.name,
          kind: fields.kind,
        });
      } else if (dialog.type === "employee-create") {
        result = await createEmployeeAction(profileSlug, entityId, fields.name);
      } else if (dialog.type === "employee-edit") {
        result = await updateEmployeeAction(profileSlug, entityId, dialog.employee.id, {
          name: fields.name,
          isActive: fields.isActive,
        });
      } else {
        const values = {
          grossMinor: parseAmountToMinor(fields.gross),
          casMinor: parseAmountToMinor(fields.cas),
          cassMinor: parseAmountToMinor(fields.cass),
          incomeTaxMinor: parseAmountToMinor(fields.incomeTax),
          camMinor: parseAmountToMinor(fields.cam),
          netMinor: parseAmountToMinor(fields.net),
          personalDeductionMinor: parseAmountToMinor(fields.personalDeduction),
        };
        if (Object.values(values).some((value) => value === null)) return;
        result = await saveSalaryProfileAction(
          profileSlug,
          entityId,
          dialog.employee.id,
          values as SalaryProfileValues,
        );
      }
      if ("error" in result) setError(result.error);
      else saved();
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result =
        deleteTarget.type === "category"
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

  const title =
    dialog?.type === "category-create"
      ? t("categoryCreate")
      : dialog?.type === "category-edit"
        ? t("categoryEdit")
        : dialog?.type === "employee-create"
          ? t("employeeCreate")
          : dialog?.type === "employee-edit"
            ? t("employeeEdit")
            : t("profileEdit");

  return (
    <>
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
                      {category.name}
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
                          aria-label={t("salaryProfile")}
                          onClick={() => openDialog({ type: "profile-edit", employee })}
                        >
                          <WalletCards {...ICON_PROPS} />
                        </Button>
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
            {dialog?.type === "profile-edit" && (
              <>
                <p className="text-secondary text-text-muted">{dialog.employee.name}</p>
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
              <Button type="submit" disabled={pending || !fields.name.trim()}>
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
              {t("deleteBody", { name: deleteTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className={errorClass}>{translateError(error)}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={pending} onClick={confirmDelete}>
              {pending ? t("working") : t("delete")}
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
