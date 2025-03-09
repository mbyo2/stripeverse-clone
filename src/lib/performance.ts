
/**
 * Simple performance monitoring utility
 */

// Track component render times
export const trackRender = (componentName: string) => {
  const startTime = performance.now();
  
  return () => {
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    // Only log slow renders in development
    if (import.meta.env.DEV && duration > 50) {
      console.warn(`Slow render: ${componentName} took ${duration.toFixed(2)}ms`);
    }
  };
};

// Track function execution time
export function measureExecutionTime<T extends (...args: any[]) => any>(
  fn: T,
  fnName: string
): (...args: Parameters<T>) => ReturnType<T> {
  return (...args: Parameters<T>): ReturnType<T> => {
    const start = performance.now();
    const result = fn(...args);
    const end = performance.now();
    
    // Only log slow executions in development
    if (import.meta.env.DEV && (end - start) > 50) {
      console.warn(`Slow execution: ${fnName} took ${(end - start).toFixed(2)}ms`);
    }
    
    return result;
  };
}

// Create a performance mark with the browser Performance API
export const mark = (name: string) => {
  if (typeof performance !== 'undefined' && performance.mark) {
    performance.mark(name);
  }
};

// Measure time between marks
export const measure = (name: string, startMark: string, endMark: string) => {
  if (typeof performance !== 'undefined' && performance.measure) {
    try {
      performance.measure(name, startMark, endMark);
      const measures = performance.getEntriesByName(name, 'measure');
      if (measures.length > 0) {
        const duration = measures[0].duration;
        if (import.meta.env.DEV && duration > 100) {
          console.warn(`Slow operation: ${name} took ${duration.toFixed(2)}ms`);
        }
      }
    } catch (e) {
      console.error('Error measuring performance:', e);
    }
  }
};
