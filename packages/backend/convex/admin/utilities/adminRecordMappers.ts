import type { Doc } from "../../_generated/dataModel";
import {
  withDaySensitiveFields,
  withMemorySensitiveFields,
  withSummarySensitiveFields,
  type DaySensitiveRecord,
  type MemorySensitiveRecord,
  type SummarySensitiveRecord,
} from "../../sensitiveDataFields";

export type AdminMemoryRecord = Doc<"memories"> & MemorySensitiveRecord;
export type AdminDayRecord = Doc<"days"> & DaySensitiveRecord;
export type AdminSummaryRecord = Doc<"daySummaries"> & SummarySensitiveRecord;

export async function mapAdminMemoryRecord(record: AdminMemoryRecord | null) {
  if (!record) {
    return null;
  }

  return await withMemorySensitiveFields(record);
}

export async function mapAdminDayRecord(record: AdminDayRecord | null) {
  if (!record) {
    return null;
  }

  return await withDaySensitiveFields(record);
}

export async function mapAdminSummaryRecord(record: AdminSummaryRecord | null) {
  if (!record) {
    return null;
  }

  return await withSummarySensitiveFields(record);
}
