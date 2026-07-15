import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  importRows,
  importSourceClaims,
  revolutBookedRows,
  revolutImportRows,
  transactionImportLinks,
} from "@/db/schema";
import type { LedgerTx } from "@/lib/ledger/service";

export type ImportProvider = "ing" | "revolut";

export function ingRowIdentity(bankAccountId: string, externalRef: string): string {
  return `${bankAccountId}:${externalRef}`;
}

export function revolutRowIdentity(contentHash: string): string {
  return contentHash;
}

export async function findActiveSourceClaim(provider: ImportProvider, rawTextHash: string) {
  const [claim] = await db
    .select()
    .from(importSourceClaims)
    .where(
      and(
        eq(importSourceClaims.provider, provider),
        eq(importSourceClaims.rawTextHash, rawTextHash),
        isNull(importSourceClaims.releasedAt),
      ),
    );
  return claim ?? null;
}

export async function findActiveImportLink(provider: ImportProvider, rowIdentity: string) {
  const [link] = await db
    .select()
    .from(transactionImportLinks)
    .where(
      and(
        eq(transactionImportLinks.provider, provider),
        eq(transactionImportLinks.rowIdentity, rowIdentity),
        isNull(transactionImportLinks.releasedAt),
      ),
    );
  return link ?? null;
}

export async function insertSourceClaim(
  tx: LedgerTx,
  params: { provider: ImportProvider; rawTextHash: string; sourceBatchId: string },
): Promise<void> {
  await tx.insert(importSourceClaims).values(params);
}

export async function insertTransactionImportLink(
  tx: LedgerTx,
  params: {
    transactionId: string;
    provider: ImportProvider;
    sourceBatchId: string;
    sourceRowId: string;
    sourceLabel: string;
    rowIdentity: string;
    rawTextHash: string;
    originalBookedAt: Date;
  },
): Promise<void> {
  await tx.insert(transactionImportLinks).values(params);
}

export async function markTransactionImportEdited(tx: LedgerTx, transactionId: string): Promise<void> {
  const modifiedAt = new Date();
  await tx
    .update(transactionImportLinks)
    .set({ modifiedAfterImport: modifiedAt })
    .where(
      and(
        eq(transactionImportLinks.transactionId, transactionId),
        isNull(transactionImportLinks.releasedAt),
      ),
    );
  await tx
    .update(importRows)
    .set({ modifiedAfterImport: true, modifiedAt })
    .where(eq(importRows.transactionId, transactionId));
  await tx
    .update(revolutImportRows)
    .set({ modifiedAfterImport: true, modifiedAt })
    .where(eq(revolutImportRows.transactionId, transactionId));
}

export async function markTransactionImportTrashed(
  tx: LedgerTx,
  transactionId: string,
): Promise<void> {
  await tx
    .update(transactionImportLinks)
    .set({ lifecycle: "trashed" })
    .where(
      and(
        eq(transactionImportLinks.transactionId, transactionId),
        isNull(transactionImportLinks.releasedAt),
      ),
    );
  await tx
    .update(importRows)
    .set({ status: "trashed" })
    .where(and(eq(importRows.transactionId, transactionId), eq(importRows.status, "booked")));
  await tx
    .update(revolutImportRows)
    .set({ status: "trashed" })
    .where(
      and(eq(revolutImportRows.transactionId, transactionId), eq(revolutImportRows.status, "booked")),
    );
}

export async function markTransactionImportRestored(
  tx: LedgerTx,
  transactionId: string,
): Promise<void> {
  await tx
    .update(transactionImportLinks)
    .set({ lifecycle: "active" })
    .where(
      and(
        eq(transactionImportLinks.transactionId, transactionId),
        isNull(transactionImportLinks.releasedAt),
      ),
    );
  await tx
    .update(importRows)
    .set({ status: "booked" })
    .where(and(eq(importRows.transactionId, transactionId), eq(importRows.status, "trashed")));
  await tx
    .update(revolutImportRows)
    .set({ status: "booked" })
    .where(
      and(
        eq(revolutImportRows.transactionId, transactionId),
        eq(revolutImportRows.status, "trashed"),
      ),
    );
}

export async function releaseBatchImportOwnership(
  tx: LedgerTx,
  provider: ImportProvider,
  sourceBatchId: string,
  reason: string,
): Promise<void> {
  const releasedAt = new Date();
  await tx
    .update(importSourceClaims)
    .set({ releasedAt, releaseReason: reason })
    .where(
      and(
        eq(importSourceClaims.provider, provider),
        eq(importSourceClaims.sourceBatchId, sourceBatchId),
        isNull(importSourceClaims.releasedAt),
      ),
    );
  await tx
    .update(transactionImportLinks)
    .set({ lifecycle: "released", releasedAt, releaseReason: reason })
    .where(
      and(
        eq(transactionImportLinks.provider, provider),
        eq(transactionImportLinks.sourceBatchId, sourceBatchId),
        isNull(transactionImportLinks.releasedAt),
      ),
    );
}

export async function releaseTransactionImportOwnership(
  tx: LedgerTx,
  transactionId: string,
  reason: string,
) {
  const links = await tx
    .select()
    .from(transactionImportLinks)
    .where(eq(transactionImportLinks.transactionId, transactionId));
  const active = links.filter((link) => link.releasedAt === null);
  const releasedAt = new Date();
  for (const link of active) {
    await tx
      .update(importSourceClaims)
      .set({ releasedAt, releaseReason: reason })
      .where(
        and(
          eq(importSourceClaims.provider, link.provider),
          eq(importSourceClaims.sourceBatchId, link.sourceBatchId),
          isNull(importSourceClaims.releasedAt),
        ),
      );
  }
  if (active.length > 0) {
    await tx
      .update(transactionImportLinks)
      .set({ lifecycle: "released", releasedAt, releaseReason: reason })
      .where(inArray(transactionImportLinks.id, active.map((link) => link.id)));
  }
  const ingRows = active.filter((link) => link.provider === "ing").map((link) => link.sourceRowId);
  await tx
    .update(importRows)
    .set({ status: "pending", transactionId: null })
    .where(eq(importRows.transactionId, transactionId));
  if (ingRows.length > 0) {
    await tx
      .update(importRows)
      .set({ status: "purged", transactionId: null })
      .where(inArray(importRows.id, ingRows));
  }
  const revolutRows = active
    .filter((link) => link.provider === "revolut")
    .map((link) => link.sourceRowId);
  await tx
    .update(revolutImportRows)
    .set({ status: "pending", transactionId: null })
    .where(eq(revolutImportRows.transactionId, transactionId));
  if (revolutRows.length > 0) {
    await tx
      .update(revolutImportRows)
      .set({ status: "purged", transactionId: null })
      .where(inArray(revolutImportRows.id, revolutRows));
    await tx.delete(revolutBookedRows).where(eq(revolutBookedRows.transactionId, transactionId));
  }
  return links;
}
