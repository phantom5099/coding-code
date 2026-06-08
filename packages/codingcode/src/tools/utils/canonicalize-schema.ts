/**
 * Recursively sort object keys to produce deterministic JSON serialization.
 *
 * Used to canonicalize tool JSON Schema so that consecutive calls with
 * structurally identical schemas produce byte-identical strings — necessary
 * for LLM provider prompt cache prefix stability.
 *
 * Special handling for JSON Schema: when an object has `properties` and
 * `required`, the `required` array is reordered to follow the same key order
 * as `properties` (which is sorted alphabetically). Without this, two
 * structurally identical zod schemas declared in different field order
 * would still produce different serialized output, since zod's `required`
 * mirrors the declaration order rather than the canonicalized `properties`
 * order.
 */
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
