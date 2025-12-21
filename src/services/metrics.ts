/**
 * Prometheus metrics for the image validation webhook
 */

interface Counter {
  value: number;
  labels: Record<string, string>;
}

interface Histogram {
  sum: number;
  count: number;
  buckets: Map<number, number>;
  labels: Record<string, string>;
}

class MetricsCollector {
  private counters = new Map<string, Map<string, Counter>>();
  private histograms = new Map<string, Map<string, Histogram>>();
  private gauges = new Map<string, Map<string, number>>();

  /**
   * Increment a counter metric
   */
  incrementCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
    const labelKey = this.getLabelKey(labels);
    
    if (!this.counters.has(name)) {
      this.counters.set(name, new Map());
    }
    
    const countersMap = this.counters.get(name)!;
    if (!countersMap.has(labelKey)) {
      countersMap.set(labelKey, { value: 0, labels });
    }
    
    countersMap.get(labelKey)!.value += value;
  }

  /**
   * Observe a histogram metric (for durations, sizes, etc.)
   */
  observeHistogram(
    name: string,
    value: number,
    labels: Record<string, string> = {},
    buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  ): void {
    const labelKey = this.getLabelKey(labels);
    
    if (!this.histograms.has(name)) {
      this.histograms.set(name, new Map());
    }
    
    const histogramsMap = this.histograms.get(name)!;
    if (!histogramsMap.has(labelKey)) {
      const bucketMap = new Map<number, number>();
      buckets.forEach((b) => bucketMap.set(b, 0));
      bucketMap.set(Infinity, 0);
      
      histogramsMap.set(labelKey, {
        sum: 0,
        count: 0,
        buckets: bucketMap,
        labels,
      });
    }
    
    const histogram = histogramsMap.get(labelKey)!;
    histogram.sum += value;
    histogram.count += 1;
    
    // Increment bucket counts
    histogram.buckets.forEach((count, bucket) => {
      if (value <= bucket) {
        histogram.buckets.set(bucket, count + 1);
      }
    });
  }

  /**
   * Set a gauge metric (for current values)
   */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const labelKey = this.getLabelKey(labels);
    
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Map());
    }
    
    this.gauges.get(name)!.set(labelKey, value);
  }

  /**
   * Increment a gauge
   */
  incrementGauge(name: string, labels: Record<string, string> = {}, value = 1): void {
    const labelKey = this.getLabelKey(labels);
    
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Map());
    }
    
    const current = this.gauges.get(name)!.get(labelKey) || 0;
    this.gauges.get(name)!.set(labelKey, current + value);
  }

  /**
   * Decrement a gauge
   */
  decrementGauge(name: string, labels: Record<string, string> = {}, value = 1): void {
    this.incrementGauge(name, labels, -value);
  }

  /**
   * Generate Prometheus text format output
   */
  generatePrometheusMetrics(): string {
    const lines: string[] = [];

    // Counters
    this.counters.forEach((countersMap, name) => {
      lines.push(`# TYPE ${name} counter`);
      countersMap.forEach((counter) => {
        const labelsStr = this.formatLabels(counter.labels);
        lines.push(`${name}${labelsStr} ${counter.value}`);
      });
    });

    // Histograms
    this.histograms.forEach((histogramsMap, name) => {
      lines.push(`# TYPE ${name} histogram`);
      histogramsMap.forEach((histogram) => {
        const baseLabels = histogram.labels;
        
        // Output buckets
        histogram.buckets.forEach((count, bucket) => {
          const labels = { ...baseLabels, le: bucket === Infinity ? "+Inf" : String(bucket) };
          const labelsStr = this.formatLabels(labels);
          lines.push(`${name}_bucket${labelsStr} ${count}`);
        });
        
        // Output sum and count
        const labelsStr = this.formatLabels(baseLabels);
        lines.push(`${name}_sum${labelsStr} ${histogram.sum}`);
        lines.push(`${name}_count${labelsStr} ${histogram.count}`);
      });
    });

    // Gauges
    this.gauges.forEach((gaugesMap, name) => {
      lines.push(`# TYPE ${name} gauge`);
      gaugesMap.forEach((value, labelKey) => {
        const labels = this.parseLabels(labelKey);
        const labelsStr = this.formatLabels(labels);
        lines.push(`${name}${labelsStr} ${value}`);
      });
    });

    return lines.join("\n") + "\n";
  }

  private getLabelKey(labels: Record<string, string>): string {
    return JSON.stringify(
      Object.keys(labels)
        .sort()
        .reduce((acc, key) => {
          acc[key] = labels[key];
          return acc;
        }, {} as Record<string, string>)
    );
  }

  private parseLabels(labelKey: string): Record<string, string> {
    try {
      return JSON.parse(labelKey);
    } catch {
      return {};
    }
  }

  private formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return "";
    
    const formatted = entries
      .map(([key, value]) => {
        // Properly escape label values for Prometheus format
        const escaped = value
          .replace(/\\/g, '\\\\')  // Escape backslashes first
          .replace(/\n/g, '\\n')     // Escape newlines
          .replace(/"/g, '\\"');    // Escape quotes
        return `${key}="${escaped}"`;
      })
      .join(",");
    
    return `{${formatted}}`;
  }
}

// Global metrics instance
export const metrics = new MetricsCollector();

// Export MetricsCollector class for testing
export { MetricsCollector };

// Metric names
export const METRICS = {
  ADMISSION_REQUESTS_TOTAL: "webhook_admission_requests_total",
  ADMISSION_REQUEST_DURATION: "webhook_admission_request_duration_seconds",
  IMAGE_VALIDATION_TOTAL: "webhook_image_validation_total",
  IMAGE_VALIDATION_DURATION: "webhook_image_validation_duration_seconds",
  REGISTRY_REQUEST_DURATION: "webhook_registry_request_duration_seconds",
  TOKEN_CACHE_HITS: "webhook_token_cache_hits_total",
  TOKEN_CACHE_MISSES: "webhook_token_cache_misses_total",
  REQUESTS_IN_FLIGHT: "webhook_requests_in_flight",
  IMAGE_CLONE_TOTAL: "webhook_image_clone_total",
  IMAGE_CLONE_DURATION: "webhook_image_clone_duration_seconds",
};
