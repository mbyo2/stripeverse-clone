
import React, { useEffect, useState, useRef, useCallback } from 'react';

export interface VirtualizationOptions {
  itemHeight: number;
  overscan?: number;
  initialIndex?: number;
}

/**
 * Hook for virtualizing large lists to improve performance
 * Only renders items that are visible in the viewport plus a small buffer
 */
export function useVirtualization<T>(
  items: T[],
  options: VirtualizationOptions
) {
  const { itemHeight, overscan = 3, initialIndex = 0 } = options;
  
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Calculate the range of visible items
  const visibleStartIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleItemCount = Math.ceil(containerHeight / itemHeight) + 2 * overscan;
  const visibleEndIndex = Math.min(items.length - 1, visibleStartIndex + visibleItemCount);
  
  // Create an array of visible items
  const visibleItems = items.slice(visibleStartIndex, visibleEndIndex + 1);
  
  // Calculate padding to maintain scroll position
  const totalHeight = items.length * itemHeight;
  const offsetY = visibleStartIndex * itemHeight;
  
  // Handle scroll events
  const handleScroll = useCallback((event: Event) => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);
  
  // Measure container on mount and resize
  const measureContainer = useCallback(() => {
    if (containerRef.current) {
      setContainerHeight(containerRef.current.clientHeight);
    }
  }, []);
  
  // Initial measurement and event listeners
  useEffect(() => {
    const currentRef = containerRef.current;
    if (currentRef) {
      measureContainer();
      currentRef.addEventListener('scroll', handleScroll);
      window.addEventListener('resize', measureContainer);
      
      // Scroll to initial position if specified
      if (initialIndex > 0) {
        currentRef.scrollTop = initialIndex * itemHeight;
      }
    }
    
    return () => {
      if (currentRef) {
        currentRef.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resize', measureContainer);
    };
  }, [handleScroll, measureContainer, initialIndex, itemHeight]);
  
  return {
    containerRef,
    visibleItems,
    totalHeight,
    offsetY,
    virtualProps: {
      style: {
        height: totalHeight,
        position: 'relative' as const,
      },
    },
    itemProps: (index: number) => ({
      style: {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        width: '100%',
        height: itemHeight,
        transform: `translateY(${(visibleStartIndex + index) * itemHeight}px)`,
      },
    }),
  };
}

/**
 * Optimized memo function that prevents unnecessary re-renders
 * for list items by performing a deep comparison of props
 */
export function memoWithDeepCompare<P>(
  Component: React.ComponentType<P>,
  areEqual: (prevProps: P, nextProps: P) => boolean
): React.MemoExoticComponent<React.ComponentType<P>> {
  return React.memo(Component, areEqual);
}

/**
 * Function to create chunks of data for batch processing
 * This helps prevent UI blocking when processing large datasets
 */
export function createDataChunks<T>(data: T[], chunkSize = 1000): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Process large datasets in chunks using requestAnimationFrame
 * to avoid blocking the main thread
 */
export async function processInChunks<T, R>(
  items: T[],
  processFn: (chunk: T[]) => R[],
  chunkSize = 1000,
  onProgress?: (processed: number, total: number) => void
): Promise<R[]> {
  const chunks = createDataChunks(items, chunkSize);
  const results: R[] = [];
  
  return new Promise<R[]>((resolve) => {
    let processed = 0;
    
    function processNextChunk(index: number) {
      if (index >= chunks.length) {
        resolve(results);
        return;
      }
      
      // Use requestAnimationFrame to yield to browser for UI updates
      requestAnimationFrame(() => {
        const result = processFn(chunks[index]);
        results.push(...result);
        
        processed += chunks[index].length;
        if (onProgress) {
          onProgress(processed, items.length);
        }
        
        processNextChunk(index + 1);
      });
    }
    
    processNextChunk(0);
  });
}
