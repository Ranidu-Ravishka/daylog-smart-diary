export function splitIntoBatches<TItem>(
  items: TItem[],
  batchSize: number,
): TItem[][] {
  if (items.length === 0) {
    return [];
  }

  const batches: TItem[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }

  return batches;
}

export function selectedDatasets<TDataset extends string>(
  input: TDataset[] | undefined,
  defaults: readonly TDataset[],
): TDataset[] {
  if (!input || input.length === 0) {
    return [...defaults];
  }

  const unique = new Set<TDataset>();
  for (const dataset of input) {
    unique.add(dataset);
  }

  return defaults.filter((dataset) => unique.has(dataset));
}

export function sanitizeExportErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 220);
  }

  return "Export generation failed.";
}

export function sanitizeRestoreErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 220);
  }

  return "Restore failed for one or more rows.";
}
