/** Subset matcher for golden expectations; returns failure descriptions (empty = match). */
export function matchSubset(actual: unknown, expected: unknown, at = "output"): string[] {
  if (isMarker(expected, "$present")) {
    return actual === undefined || actual === null ? [`${at}: expected a value, got ${JSON.stringify(actual)}`] : [];
  }

  if (isMarker(expected, "$contains")) {
    const needle = expected.$contains;
    return typeof actual === "string" && typeof needle === "string" && actual.includes(needle)
      ? []
      : [`${at}: expected a string containing ${JSON.stringify(needle)}, got ${JSON.stringify(actual)}`];
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return [`${at}: expected an array of length ${expected.length}, got ${JSON.stringify(actual)}`];
    }
    return expected.flatMap((item, index) => matchSubset(actual[index], item, `${at}[${index}]`));
  }

  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
      return [`${at}: expected an object, got ${JSON.stringify(actual)}`];
    }
    const record = actual as Record<string, unknown>;
    return Object.entries(expected).flatMap(([key, value]) => {
      if (isMarker(value, "$absent")) {
        return key in record ? [`${at}.${key}: expected to be absent, got ${JSON.stringify(record[key])}`] : [];
      }
      return key in record
        ? matchSubset(record[key], value, `${at}.${key}`)
        : [`${at}.${key}: missing (expected ${JSON.stringify(value)})`];
    });
  }

  return Object.is(actual, expected)
    ? []
    : [`${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
}

function isMarker(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && key in value;
}
