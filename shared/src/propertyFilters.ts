import type { PropertyFilter } from "./types.js";

export function evaluateFilter(
  properties: Record<string, unknown>,
  filter: PropertyFilter,
): boolean {
  const value = properties[filter.property];
  if (value === undefined) return false;

  switch (filter.operator) {
    case "eq":
      return value === filter.value;
    case "neq":
      return value !== filter.value;
    case "gt":
      return (
        typeof value === "number" &&
        typeof filter.value === "number" &&
        value > filter.value
      );
    case "lt":
      return (
        typeof value === "number" &&
        typeof filter.value === "number" &&
        value < filter.value
      );
    case "gte":
      return (
        typeof value === "number" &&
        typeof filter.value === "number" &&
        value >= filter.value
      );
    case "lte":
      return (
        typeof value === "number" &&
        typeof filter.value === "number" &&
        value <= filter.value
      );
    case "in":
      return (
        Array.isArray(filter.value) &&
        (filter.value as unknown[]).includes(value)
      );
    default:
      return false;
  }
}

export function evaluateFilters(
  properties: Record<string, unknown>,
  filters: PropertyFilter[],
): boolean {
  return filters.every((f) => evaluateFilter(properties, f));
}
