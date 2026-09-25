export function canonicalRecapJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRecapJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalRecapJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
