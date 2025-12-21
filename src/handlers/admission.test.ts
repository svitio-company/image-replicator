import { describe, test, expect } from "bun:test";
import { extractImagesFromObject } from "./admission";
import type { PodSpec, DeploymentSpec, CronJobSpec } from "../types";

describe("extractImagesFromObject", () => {
  test("should extract images from Pod spec", () => {
    const spec: PodSpec = {
      containers: [
        { name: "nginx", image: "nginx:latest" },
        { name: "redis", image: "redis:7" },
      ],
    };

    const images = extractImagesFromObject("Pod", spec);
    expect(images).toEqual(["nginx:latest", "redis:7"]);
  });

  test("should extract init container images", () => {
    const spec: PodSpec = {
      containers: [{ name: "app", image: "myapp:v1" }],
      initContainers: [{ name: "init", image: "busybox:latest" }],
    };

    const images = extractImagesFromObject("Pod", spec);
    expect(images).toEqual(["myapp:v1", "busybox:latest"]);
  });

  test("should extract ephemeral container images", () => {
    const spec: PodSpec = {
      containers: [{ name: "app", image: "myapp:v1" }],
      ephemeralContainers: [{ name: "debug", image: "busybox:latest" }],
    };

    const images = extractImagesFromObject("Pod", spec);
    expect(images).toEqual(["myapp:v1", "busybox:latest"]);
  });

  test("should extract images from Deployment spec", () => {
    const spec: DeploymentSpec = {
      replicas: 3,
      template: {
        spec: {
          containers: [{ name: "nginx", image: "nginx:alpine" }],
        },
      },
    };

    const images = extractImagesFromObject("Deployment", spec);
    expect(images).toEqual(["nginx:alpine"]);
  });

  test("should extract images from CronJob spec", () => {
    const spec: CronJobSpec = {
      schedule: "*/5 * * * *",
      jobTemplate: {
        spec: {
          template: {
            spec: {
              containers: [{ name: "job", image: "busybox:latest" }],
            },
          },
        },
      },
    };

    const images = extractImagesFromObject("CronJob", spec);
    expect(images).toEqual(["busybox:latest"]);
  });

  test("should return unique images only", () => {
    const spec: PodSpec = {
      containers: [
        { name: "nginx1", image: "nginx:latest" },
        { name: "nginx2", image: "nginx:latest" },
      ],
    };

    const images = extractImagesFromObject("Pod", spec);
    expect(images).toEqual(["nginx:latest"]);
  });

  test("should return empty array for empty spec", () => {
    const images = extractImagesFromObject("Pod", {});
    expect(images).toEqual([]);
  });

  test("should return empty array for null spec", () => {
    const images = extractImagesFromObject("Pod", null);
    expect(images).toEqual([]);
  });

  test("should handle StatefulSet", () => {
    const spec = {
      serviceName: "web",
      replicas: 3,
      template: {
        spec: {
          containers: [{ name: "nginx", image: "nginx:latest" }],
        },
      },
    };

    const images = extractImagesFromObject("StatefulSet", spec);
    expect(images).toEqual(["nginx:latest"]);
  });

  test("should handle DaemonSet", () => {
    const spec = {
      template: {
        spec: {
          containers: [{ name: "fluentd", image: "fluentd:latest" }],
        },
      },
    };

    const images = extractImagesFromObject("DaemonSet", spec);
    expect(images).toEqual(["fluentd:latest"]);
  });

  test("should extract from unknown spec with common pattern", () => {
    const spec = {
      template: {
        spec: {
          containers: [{ name: "app", image: "myapp:v1" }],
        },
      },
    };

    const images = extractImagesFromObject("CustomResource", spec);
    expect(images).toEqual(["myapp:v1"]);
  });

  test("should handle missing image field", () => {
    const spec: PodSpec = {
      containers: [
        { name: "nginx", image: "nginx:latest" },
        { name: "no-image" } as any,
      ],
    };

    const images = extractImagesFromObject("Pod", spec);
    expect(images).toEqual(["nginx:latest"]);
  });

  test("should extract all container types together", () => {
    const spec: PodSpec = {
      containers: [
        { name: "app", image: "app:v1" },
        { name: "sidecar", image: "sidecar:v1" },
      ],
      initContainers: [
        { name: "init1", image: "init:v1" },
        { name: "init2", image: "init:v2" },
      ],
      ephemeralContainers: [{ name: "debug", image: "debug:latest" }],
    };

    const images = extractImagesFromObject("Pod", spec);
    expect(images).toHaveLength(5);
    expect(images).toContain("app:v1");
    expect(images).toContain("sidecar:v1");
    expect(images).toContain("init:v1");
    expect(images).toContain("init:v2");
    expect(images).toContain("debug:latest");
  });
});
