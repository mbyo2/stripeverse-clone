
/**
 * Utility functions for optimizing list performance
 */

// Generate a stable key for list items
export function getStableKey(item: any, index: number, keyProp: string = 'id'): string {
  // If the item has the specified key property, use it
  if (item && typeof item === 'object' && keyProp in item) {
    return `${keyProp}-${item[keyProp]}`;
  }
  
  // Fall back to index if no key property is available
  return `index-${index}`;
}

// Windowing function for large lists
export function windowedList<T>(
  items: T[],
  visibleCount: number,
  startIndex: number = 0
): T[] {
  return items.slice(startIndex, startIndex + visibleCount);
}

// Batch DOM updates for smoother rendering of large lists
export function batchRender<T>(items: T[], batchSize: number = 50): Promise<T[][]> {
  const batches: T[][] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  
  return Promise.resolve(batches);
}

// Memoize expensive list operations
const memoizedResults = new Map<string, any>();

export function memoizedListOperation<T, R>(
  items: T[],
  operation: (items: T[]) => R,
  cacheKey?: string
): R {
  const key = cacheKey || JSON.stringify(items);
  
  if (memoizedResults.has(key)) {
    return memoizedResults.get(key);
  }
  
  const result = operation(items);
  memoizedResults.set(key, result);
  
  return result;
}

// Clear the memoization cache
export function clearMemoizedResults(): void {
  memoizedResults.clear();
}
