/**
 * Performance benchmarks for the image validation webhook
 * Run with: bun run benchmark
 */

import { extractImagesFromObject } from "./src/handlers/admission";
import { parseImageReference } from "./src/utils/image-parser";
import type { PodSpec, DeploymentSpec } from "./src/types";

interface BenchmarkResult {
  name: string;
  ops_per_sec: number;
  avg_time_ms: number;
  min_time_ms: number;
  max_time_ms: number;
}

async function benchmark(name: string, fn: () => void, iterations = 10000): Promise<BenchmarkResult> {
  // Warmup
  for (let i = 0; i < 100; i++) {
    fn();
  }

  // Actual benchmark
  const times: number[] = [];
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    const iterStart = performance.now();
    fn();
    times.push(performance.now() - iterStart);
  }

  const end = performance.now();
  const totalTime = end - start;
  const opsPerSec = (iterations / totalTime) * 1000;

  return {
    name,
    ops_per_sec: Math.round(opsPerSec),
    avg_time_ms: totalTime / iterations,
    min_time_ms: Math.min(...times),
    max_time_ms: Math.max(...times),
  };
}

async function runBenchmarks() {
  console.log("🚀 Running performance benchmarks...\n");

  const results: BenchmarkResult[] = [];

  // Benchmark 1: Image reference parsing
  results.push(
    await benchmark("Parse Docker Hub image", () => {
      parseImageReference("nginx:latest");
    })
  );

  results.push(
    await benchmark("Parse GCR image", () => {
      parseImageReference("gcr.io/project/image:v1.0.0");
    })
  );

  results.push(
    await benchmark("Parse image with digest", () => {
      parseImageReference("nginx@sha256:abcdef123456");
    })
  );

  // Benchmark 2: Image extraction from Pod
  const simplePodSpec: PodSpec = {
    containers: [
      { name: "nginx", image: "nginx:latest" },
      { name: "redis", image: "redis:7" },
    ],
  };

  results.push(
    await benchmark("Extract images from simple Pod", () => {
      extractImagesFromObject("Pod", simplePodSpec);
    })
  );

  // Benchmark 3: Image extraction from complex Pod
  const complexPodSpec: PodSpec = {
    containers: [
      { name: "app", image: "myapp:v1" },
      { name: "sidecar1", image: "sidecar:latest" },
      { name: "sidecar2", image: "proxy:v2" },
    ],
    initContainers: [
      { name: "init1", image: "init:v1" },
      { name: "init2", image: "init:v2" },
    ],
    ephemeralContainers: [
      { name: "debug", image: "debug:latest" },
    ],
  };

  results.push(
    await benchmark("Extract images from complex Pod", () => {
      extractImagesFromObject("Pod", complexPodSpec);
    })
  );

  // Benchmark 4: Image extraction from Deployment
  const deploymentSpec: DeploymentSpec = {
    replicas: 3,
    template: {
      spec: {
        containers: [
          { name: "app", image: "nginx:alpine" },
        ],
      },
    },
  };

  results.push(
    await benchmark("Extract images from Deployment", () => {
      extractImagesFromObject("Deployment", deploymentSpec);
    })
  );

  // Print results
  console.log("📊 Benchmark Results:\n");
  console.log("┌─────────────────────────────────────────────┬──────────────┬──────────────┬──────────────┬──────────────┐");
  console.log("│ Benchmark                                   │ Ops/sec      │ Avg (ms)     │ Min (ms)     │ Max (ms)     │");
  console.log("├─────────────────────────────────────────────┼──────────────┼──────────────┼──────────────┼──────────────┤");

  results.forEach((result) => {
    const name = result.name.padEnd(43);
    const ops = result.ops_per_sec.toLocaleString().padStart(12);
    const avg = result.avg_time_ms.toFixed(4).padStart(12);
    const min = result.min_time_ms.toFixed(4).padStart(12);
    const max = result.max_time_ms.toFixed(4).padStart(12);
    console.log(`│ ${name} │ ${ops} │ ${avg} │ ${min} │ ${max} │`);
  });

  console.log("└─────────────────────────────────────────────┴──────────────┴──────────────┴──────────────┴──────────────┘");

  // Export results for GitHub Actions
  const jsonResults = {
    benchmarks: results.map((r) => ({
      name: r.name,
      unit: "ops/sec",
      value: r.ops_per_sec,
    })),
  };

  await Bun.write("benchmark-results.json", JSON.stringify(jsonResults, null, 2));
  console.log("\n✅ Results saved to benchmark-results.json");

  // Performance assertions
  console.log("\n🔍 Performance Checks:");

  const failures: string[] = [];

  // Image parsing should be fast (> 100k ops/sec)
  const parsingBenchmark = results.find((r) => r.name.includes("Parse Docker Hub"));
  if (parsingBenchmark && parsingBenchmark.ops_per_sec < 100000) {
    failures.push(`Image parsing too slow: ${parsingBenchmark.ops_per_sec} ops/sec (expected > 100,000)`);
  } else {
    console.log("  ✅ Image parsing performance: OK");
  }

  // Image extraction should be fast (> 50k ops/sec)
  const extractionBenchmark = results.find((r) => r.name.includes("simple Pod"));
  if (extractionBenchmark && extractionBenchmark.ops_per_sec < 50000) {
    failures.push(`Image extraction too slow: ${extractionBenchmark.ops_per_sec} ops/sec (expected > 50,000)`);
  } else {
    console.log("  ✅ Image extraction performance: OK");
  }

  if (failures.length > 0) {
    console.log("\n❌ Performance checks failed:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }

  console.log("\n✅ All performance checks passed!");
}

// Run benchmarks
runBenchmarks().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
