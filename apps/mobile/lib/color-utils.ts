export function withOpacity(hexColor: string, alpha: number): string {
  const normalized = hexColor.replace("#", "").trim();
  if (normalized.length !== 6) {
    return hexColor;
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  if ([red, green, blue].some((value) => Number.isNaN(value))) {
    return hexColor;
  }

  const boundedAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${red}, ${green}, ${blue}, ${boundedAlpha})`;
}
