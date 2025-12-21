import { describe, test, expect, beforeEach } from "bun:test";
import { MetricsCollector } from "./metrics";

describe("MetricsCollector", () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  describe("Counter", () => {
    test("should increment counter", () => {
      metrics.incrementCounter("test_counter", { label: "value" });
      const output = metrics.generatePrometheusMetrics();
      
      expect(output).toContain("# TYPE test_counter counter");
      expect(output).toContain('test_counter{label="value"} 1');
    });

    test("should increment counter by custom value", () => {
      metrics.incrementCounter("test_counter", { label: "value" }, 5);
      const output = metrics.generatePrometheusMetrics();
      
      expect(output).toContain('test_counter{label="value"} 5');
    });

    test("should accumulate counter values", () => {
      metrics.incrementCounter("test_counter", { label: "value" });
      metrics.incrementCounter("test_counter", { label: "value" });
      metrics.incrementCounter("test_counter", { label: "value" }, 3);
      
      const output = metrics.generatePrometheusMetrics();
      expect(output).toContain('test_counter{label="value"} 5');
    });

    test("should handle multiple label combinations", () => {
      metrics.incrementCounter("test_counter", { status: "success" });
      metrics.incrementCounter("test_counter", { status: "error" });
      
      const output = metrics.generatePrometheusMetrics();
      expect(output).toContain('test_counter{status="success"} 1');
      expect(output).toContain('test_counter{status="error"} 1');
    });

    test("should handle counters without labels", () => {
      metrics.incrementCounter("test_counter");
      const output = metrics.generatePrometheusMetrics();
      
      expect(output).toContain("test_counter 1");
    });
  });

  describe("Histogram", () => {
    test("should observe histogram values", () => {
      metrics.observeHistogram("test_histogram", 0.5, { label: "value" });
      const output = metrics.generatePrometheusMetrics();
      
      expect(output).toContain("# TYPE test_histogram histogram");
      expect(output).toContain('test_histogram_bucket{label="value",le="0.5"} 1');
      expect(output).toContain('test_histogram_bucket{label="value",le="+Inf"} 1');
      expect(output).toContain('test_histogram_sum{label="value"} 0.5');
      expect(output).toContain('test_histogram_count{label="value"} 1');
    });

    test("should accumulate histogram values", () => {
      metrics.observeHistogram("test_histogram", 0.1, { label: "value" });
      metrics.observeHistogram("test_histogram", 0.5, { label: "value" });
      metrics.observeHistogram("test_histogram", 2.0, { label: "value" });
      
      const output = metrics.generatePrometheusMetrics();
      expect(output).toContain('test_histogram_sum{label="value"} 2.6');
      expect(output).toContain('test_histogram_count{label="value"} 3');
    });

    test("should track buckets correctly", () => {
      metrics.observeHistogram("test_histogram", 0.05, {});
      metrics.observeHistogram("test_histogram", 0.5, {});
      metrics.observeHistogram("test_histogram", 5.0, {});
      
      const output = metrics.generatePrometheusMetrics();
      expect(output).toContain('test_histogram_bucket{le="0.1"} 1'); // Only 0.05
      expect(output).toContain('test_histogram_bucket{le="1"} 2');   // 0.05 and 0.5
      expect(output).toContain('test_histogram_bucket{le="10"} 3');  // All values
    });
  });

  describe("Gauge", () => {
    test("should set gauge value", () => {
      metrics.setGauge("test_gauge", 42, { label: "value" });
      const output = metrics.generatePrometheusMetrics();
      
      expect(output).toContain("# TYPE test_gauge gauge");
      expect(output).toContain('test_gauge{label="value"} 42');
    });

    test("should overwrite gauge value", () => {
      metrics.setGauge("test_gauge", 10, { label: "value" });
      metrics.setGauge("test_gauge", 20, { label: "value" });
      
      const output = metrics.generatePrometheusMetrics();
      expect(output).toContain('test_gauge{label="value"} 20');
    });

    test("should increment gauge", () => {
      metrics.setGauge("test_gauge", 10, { label: "value" });
      metrics.incrementGauge("test_gauge", { label: "value" }, 5);
      
      const output = metrics.generatePrometheusMetrics();
      expect(output).toContain('test_gauge{label="value"} 15');
    });

    test("should decrement gauge", () => {
      metrics.setGauge("test_gauge", 10, { label: "value" });
      metrics.decrementGauge("test_gauge", { label: "value" }, 3);
      
      const output = metrics.generatePrometheusMetrics();
      expect(output).toContain('test_gauge{label="value"} 7');
    });

    test("should handle gauge without initial value", () => {
      metrics.incrementGauge("test_gauge", { label: "value" }, 5);
      const output = metrics.generatePrometheusMetrics();
      expect(output).toContain('test_gauge{label="value"} 5');
    });
  });

  describe("Label formatting", () => {
    test("should escape quotes in label values", () => {
      metrics.incrementCounter("test_counter", { label: 'value"with"quotes' });
      const output = metrics.generatePrometheusMetrics();
      
      expect(output).toContain('test_counter{label="value\\"with\\"quotes"} 1');
    });

    test("should sort labels consistently", () => {
      metrics.incrementCounter("test_counter", { z: "last", a: "first", m: "middle" });
      
      // Labels should be in consistent order (same input produces same output)
      const output1 = metrics.generatePrometheusMetrics();
      
      const metrics2 = new MetricsCollector();
      metrics2.incrementCounter("test_counter", { a: "first", m: "middle", z: "last" });
      const output2 = metrics2.generatePrometheusMetrics();
      
      // Same label sets should produce identical output
      expect(output1).toBe(output2);
    });
  });

  describe("Multiple metrics", () => {
    test("should output all metric types together", () => {
      metrics.incrementCounter("test_counter", {});
      metrics.observeHistogram("test_histogram", 1.5, {});
      metrics.setGauge("test_gauge", 42, {});
      
      const output = metrics.generatePrometheusMetrics();
      
      expect(output).toContain("# TYPE test_counter counter");
      expect(output).toContain("# TYPE test_histogram histogram");
      expect(output).toContain("# TYPE test_gauge gauge");
    });
  });
});
