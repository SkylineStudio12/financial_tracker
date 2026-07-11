import type en from "../../messages/en.json";

type MessageLeafPaths<T> = {
  [K in Extract<keyof T, string>]: T[K] extends string ? K : `${K}.${MessageLeafPaths<T[K]>}`;
}[Extract<keyof T, string>];

type ErrorCatalogKey = MessageLeafPaths<(typeof en)["errors"]>;

export const ERROR_CODES = [
  "profile.unknownEntity",
  "profile.unknownCompany",
  "profile.unknownInvestment",
  "ledger.invalidTransactionDate",
  "ledger.descriptionRequired",
  "ledger.postingsNeedAtLeastTwo",
  "ledger.postingAmountInvalid",
  "ledger.ronAmountInvalid",
  "ledger.accountNotFound",
  "ledger.accountInactive",
  "ledger.categoryNotFound",
  "ledger.categoryWrongEntity",
  "ledger.transferCategorized",
  "ledger.taxAccrualCategorized",
  "ledger.categoryOnRealAccount",
  "ledger.standardEquityCategoryRequired",
  "ledger.ronZeroSum",
  "ledger.duplicateExternalRefInTransaction",
  "ledger.accrualPostingMissing",
  "ledger.accrualPostingNotTaxLiability",
  "ledger.transactionNotFound",
  "ledger.importedRefsMustBePreserved",
  "ledger.tradeTransactionCannotBeEdited",
  "ledger.importBatchDuplicateExternalRef",
  "ledger.consumedBuyCannotBeDeleted",
  "forms.accountNotFound",
  "forms.equityAccountMissing",
  "forms.tagCreateFailed",
  "forms.pickAtLeastOneCategory",
  "forms.splitAmountPositive",
  "forms.splitCategoryRequired",
  "forms.splitSumMismatch",
  "forms.sameAccountTransfer",
  "forms.amountPositive",
  "forms.receivedAmountRequired",
  "flows.invalidMonth",
  "flows.notCompanyEntity",
  "flows.companyAccountsMissing",
  "flows.employeeNameRequired",
  "flows.grossAmountPositive",
  "flows.invalidDate",
  "investments.tradeTotalPositive",
  "investments.ronTotalPositive",
  "investments.sharePricePositive",
  "investments.ronTradeTotalsMismatch",
  "investments.tradeTotalsDoNotReconcile",
  "investments.accountNotFound",
  "investments.accountInactive",
  "investments.securityNotFound",
  "investments.securityCurrencyMismatch",
  "investments.categoryMissing",
  "investments.equityAccountMissing",
  "investments.buyMissingPositionLeg",
  "investments.sellOverConsumesLots",
  "investments.brokerageAccountRequired",
  "investments.buyPositionAccountRequired",
  "investments.buyPositionAccountMismatch",
  "investments.sellLotsSpanPositions",
  "investments.sellDustBasisMismatch",
  "investments.sellForeignGainRoundsToZeroRon",
  "investments.dividendSecurityRequired",
  "investments.tickerInvalid",
  "investments.securityNameRequired",
  "investments.securityCurrencyConflict",
  "investments.buySellQuantityAndPriceRequired",
  "investments.invalidSnapshotDate",
  "investments.snapshotFuture",
  "investments.snapshotPricePositive",
  "investments.invalidShareQuantity",
  "investments.shareQuantityPositive",
  "investments.invalidPrice",
  "investments.holdingValueUnsafe",
  "investments.valuationDateOutOfRange",
  "investments.stockSplitRatioInvalid",
  "investments.stockSplitNoOpenLots",
  "investments.stockSplitDeltaMismatch",
  "imports.statementAccountNotFound",
  "imports.statementAccountMustBeActiveBank",
  "imports.statementAccountMustBeRon",
  "imports.statementTextAlreadyImported",
  "imports.rowNotFound",
  "imports.rowAlreadyStatus",
  "imports.batchNotFound",
  "imports.equityAccountMissing",
  "imports.rowDescriptionMissing",
  "imports.statePaymentTaxLiabilityMissing",
  "imports.categoryRequiredForLine",
  "imports.statementTextRequired",
  "imports.highConfidenceBookingFailed",
  "revolut.requiredAccountsMissing",
  "revolut.csvRequired",
  "revolut.unpairedCorrections",
  "revolut.securityCurrencyConflict",
  "revolut.batchNotFound",
  "revolut.batchAlreadyBooked",
  "revolut.rowNotFound",
  "revolut.rowLocked",
  "revolut.excludedBuyNeededBySell",
  "revolut.excludedBuyNeededBySplit",
  "revolut.splitDependencyInvalid",
  "revolut.splitRatioMissing",
  "revolut.unsupportedBookingKind",
  "revolut.securityMissing",
  "revolut.bookingRowFailed",
  "revolut.cashAssertionFailed",
  "revolut.holdingsAssertionFailed",
  "revolut.zeroSumAssertionFailed",
  "revolut.taxAccrualAssertionFailed",
  "tax.companyTaxLiabilityMissing",
  "tax.taxesCategoryMissing",
  "tax.taxRuleMissing",
] as const satisfies readonly ErrorCatalogKey[];

export type AppErrorCode = (typeof ERROR_CODES)[number];

type CatalogHasNoExtraKeys = Exclude<ErrorCatalogKey, AppErrorCode> extends never ? true : never;
const catalogHasNoExtraKeys: CatalogHasNoExtraKeys = true;
void catalogHasNoExtraKeys;

export type AppErrorParams = Record<string, string | number>;

export interface AppError {
  code: AppErrorCode;
  params?: AppErrorParams;
}

export class LedgerValidationError extends Error {
  code: AppErrorCode;
  params?: AppErrorParams;

  constructor(code: AppErrorCode, params?: AppErrorParams) {
    super(code);
    this.name = "LedgerValidationError";
    this.code = code;
    this.params = params;
  }

  toAppError(): AppError {
    return this.params ? { code: this.code, params: this.params } : { code: this.code };
  }
}

export function toAppError(error: unknown): AppError | null {
  return error instanceof LedgerValidationError ? error.toAppError() : null;
}

export function errorMessageKey(code: AppErrorCode): ErrorCatalogKey {
  return code;
}
