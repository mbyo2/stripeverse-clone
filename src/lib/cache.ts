
/**
 * A simple in-memory cache utility for storing computed values
 */
class Cache {
  private cache: Map<string, { value: any; expiry: number | null }> = new Map();

  /**
   * Set a value in the cache
   * @param key The cache key
   * @param value The value to store
   * @param ttl Time to live in milliseconds (optional)
   */
  set(key: string, value: any, ttl?: number): void {
    const expiry = ttl ? Date.now() + ttl : null;
    this.cache.set(key, { value, expiry });
  }

  /**
   * Get a value from the cache
   * @param key The cache key
   * @returns The stored value or undefined if not found or expired
   */
  get(key: string): any {
    const entry = this.cache.get(key);
    
    if (!entry) return undefined;
    
    // Check if the entry has expired
    if (entry.expiry && entry.expiry < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    
    return entry.value;
  }

  /**
   * Delete a value from the cache
   * @param key The cache key
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all values from the cache
   */
  clear(): void {
    this.cache.clear();
  }
}

// Export a singleton instance
export const cache = new Cache();

/**
 * A utility function for memoizing expensive computations with TTL
 * @param fn The function to memoize
 * @param keyFn A function that returns a key for the cache based on args
 * @param ttl Time to live in milliseconds (optional)
 * @returns The memoized function
 */
export function memoize<T extends (...args: any[]) => any>(
  fn: T,
  keyFn?: (...args: Parameters<T>) => string,
  ttl?: number
): (...args: Parameters<T>) => ReturnType<T> {
  return (...args: Parameters<T>): ReturnType<T> => {
    const key = keyFn 
      ? keyFn(...args) 
      : `${fn.name}:${JSON.stringify(args)}`;
    
    const cachedValue = cache.get(key);
    if (cachedValue !== undefined) {
      return cachedValue;
    }
    
    const result = fn(...args);
    cache.set(key, result, ttl);
    return result;
  };
}
