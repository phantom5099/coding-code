export function canonicalizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeSchema);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = canonicalizeSchema(obj[k]);
    }
    // Realign `required` to match the (now-sorted) `properties` key order.
    if (
      Array.isArray(sorted.required) &&
      sorted.properties &&
      typeof sorted.properties === 'object'
    ) {
      const propKeys = Object.keys(sorted.properties);
      const requiredSet = new Set<string>(sorted.required as string[]);
      sorted.required = propKeys.filter((k) => requiredSet.has(k));
    }
    return sorted;
  }
  return value;
}
