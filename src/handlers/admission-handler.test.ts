import { describe, test, expect, mock, beforeEach } from "bun:test";
import { handleAdmissionReview } from "./admission";
import { RegistryClient } from "../services/registry-client";
import type { AdmissionReviewRequest, RegistryAuthConfig } from "../types";

describe("handleAdmissionReview", () => {
  let registryClient: RegistryClient;
  let authConfig: RegistryAuthConfig;

  beforeEach(() => {
    authConfig = {
      credentials: new Map(),
    };
    registryClient = new RegistryClient(authConfig);
  });

  describe("subresource handling", () => {
    test("should skip validation for subresources", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "test-uid-123",
          kind: { kind: "Deployment", group: "apps", version: "v1" },
          resource: { group: "apps", version: "v1", resource: "deployments" },
          operation: "UPDATE",
          object: {
            metadata: { name: "test-deployment" },
            spec: {
              replicas: 3,
              template: {
                spec: {
                  containers: [{ name: "nginx", image: "nginx:latest" }],
                },
              },
            },
          },
          subResource: "scale",
        } as any,
      };

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.response.allowed).toBe(true);
      expect(response.response.uid).toBe("test-uid-123");
    });
  });

  describe("operation filtering", () => {
    test("should skip DELETE operations", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "test-uid-123",
          kind: { kind: "Pod", group: "", version: "v1" },
          resource: { group: "", version: "v1", resource: "pods" },
          operation: "DELETE",
          object: {
            metadata: { name: "test-pod" },
            spec: {
              containers: [{ name: "nginx", image: "nginx:latest" }],
            },
          },
        },
      };

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.response.allowed).toBe(true);
    });

    test("should validate CREATE operations", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "test-uid-123",
          kind: { kind: "Pod", group: "", version: "v1" },
          resource: { group: "", version: "v1", resource: "pods" },
          operation: "CREATE",
          object: {
            metadata: { name: "test-pod" },
            spec: {
              containers: [{ name: "nginx", image: "nginx:latest" }],
            },
          },
        },
      };

      // Mock checkImages to return success
      registryClient.checkImages = mock(() => 
        Promise.resolve([{ image: "nginx:latest", exists: true, registry: "docker.io" }])
      );

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.response.allowed).toBe(true);
    });

    test("should validate UPDATE operations", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "test-uid-123",
          kind: { kind: "Pod", group: "", version: "v1" },
          resource: { group: "", version: "v1", resource: "pods" },
          operation: "UPDATE",
          object: {
            metadata: { name: "test-pod" },
            spec: {
              containers: [{ name: "nginx", image: "nginx:latest" }],
            },
          },
        },
      };

      registryClient.checkImages = mock(() => 
        Promise.resolve([{ image: "nginx:latest", exists: true, registry: "docker.io" }])
      );

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.response.allowed).toBe(true);
    });
  });

  describe("no images handling", () => {
    test("should allow objects with no images", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "test-uid-123",
          kind: { kind: "ConfigMap", group: "", version: "v1" },
          resource: { group: "", version: "v1", resource: "configmaps" },
          operation: "CREATE",
          object: {
            metadata: { name: "test-config" },
            data: { key: "value" },
          },
        },
      };

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.response.allowed).toBe(true);
    });

    test("should allow pods with empty container list", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "test-uid-123",
          kind: { kind: "Pod", group: "", version: "v1" },
          resource: { group: "", version: "v1", resource: "pods" },
          operation: "CREATE",
          object: {
            metadata: { name: "test-pod" },
            spec: {
              containers: [],
            },
          },
        },
      };

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.response.allowed).toBe(true);
    });
  });

  describe("image validation", () => {
    test("should allow when all images exist", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "test-uid-123",
          kind: { kind: "Pod", group: "", version: "v1" },
          resource: { group: "", version: "v1", resource: "pods" },
          operation: "CREATE",
          object: {
            metadata: { name: "test-pod" },
            spec: {
              containers: [
                { name: "nginx", image: "nginx:latest" },
                { name: "redis", image: "redis:7" },
              ],
            },
          },
        },
      };

      registryClient.checkImages = mock(() => 
        Promise.resolve([
          { image: "nginx:latest", exists: true, registry: "docker.io" },
          { image: "redis:7", exists: true, registry: "docker.io" },
        ])
      );

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.response.allowed).toBe(true);
    });

    test("should deny when images don't exist and no target registry", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "test-uid-123",
          kind: { kind: "Pod", group: "", version: "v1" },
          resource: { group: "", version: "v1", resource: "pods" },
          operation: "CREATE",
          object: {
            metadata: { name: "test-pod" },
            spec: {
              containers: [{ name: "invalid", image: "invalid-image:v999" }],
            },
          },
        },
      };

      registryClient.checkImages = mock(() => 
        Promise.resolve([
          { image: "invalid-image:v999", exists: false, registry: "docker.io" },
        ])
      );

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.response.allowed).toBe(false);
      expect(response.response.status?.message).toContain("invalid-image:v999");
    });

    test("should provide detailed error messages for multiple missing images", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "test-uid-123",
          kind: { kind: "Pod", group: "", version: "v1" },
          resource: { group: "", version: "v1", resource: "pods" },
          operation: "CREATE",
          object: {
            metadata: { name: "test-pod" },
            spec: {
              containers: [
                { name: "app1", image: "invalid1:v1" },
                { name: "app2", image: "invalid2:v2" },
              ],
            },
          },
        },
      };

      registryClient.checkImages = mock(() => 
        Promise.resolve([
          { image: "invalid1:v1", exists: false, registry: "docker.io" },
          { image: "invalid2:v2", exists: false, registry: "docker.io" },
        ])
      );

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.response.allowed).toBe(false);
      expect(response.response.status?.message).toContain("invalid1:v1");
      expect(response.response.status?.message).toContain("invalid2:v2");
    });
  });

  describe("image cloning with target registry", () => {
    beforeEach(() => {
      registryClient = new RegistryClient(authConfig, "myregistry.io");
    });

    test("should allow when images exist in target registry", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "test-uid-123",
          kind: { kind: "Pod", group: "", version: "v1" },
          resource: { group: "", version: "v1", resource: "pods" },
          operation: "CREATE",
          object: {
            metadata: { name: "test-pod" },
            spec: {
              containers: [{ name: "nginx", image: "nginx:latest" }],
            },
          },
        },
      };

      registryClient.checkImages = mock(() => 
        Promise.resolve([{ image: "nginx:latest", exists: true, registry: "myregistry.io" }])
      );

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.response.allowed).toBe(true);
    });

    test("should clone missing images to target registry", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "test-uid-123",
          kind: { kind: "Pod", group: "", version: "v1" },
          resource: { group: "", version: "v1", resource: "pods" },
          operation: "CREATE",
          object: {
            metadata: { name: "test-pod" },
            spec: {
              containers: [{ name: "nginx", image: "nginx:latest" }],
            },
          },
        },
      };

      registryClient.checkImages = mock(() => 
        Promise.resolve([{ image: "nginx:latest", exists: false, registry: "myregistry.io" }])
      );

      registryClient.cloneImage = mock(() => 
        Promise.resolve({ success: true })
      );

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.response.allowed).toBe(true);
      expect(registryClient.cloneImage).toHaveBeenCalledWith("nginx:latest", "myregistry.io");
    });

    test("should deny when cloning fails", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "test-uid-123",
          kind: { kind: "Pod", group: "", version: "v1" },
          resource: { group: "", version: "v1", resource: "pods" },
          operation: "CREATE",
          object: {
            metadata: { name: "test-pod" },
            spec: {
              containers: [{ name: "nginx", image: "nginx:latest" }],
            },
          },
        },
      };

      registryClient.checkImages = mock(() => 
        Promise.resolve([{ image: "nginx:latest", exists: false, registry: "myregistry.io" }])
      );

      registryClient.cloneImage = mock(() => 
        Promise.resolve({ success: false, error: "Authentication failed" })
      );

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.response.allowed).toBe(false);
      expect(response.response.status?.message).toContain("Authentication failed");
    });
  });

  describe("response format", () => {
    test("should include correct apiVersion and kind", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "test-uid-123",
          kind: { kind: "Pod", group: "", version: "v1" },
          resource: { group: "", version: "v1", resource: "pods" },
          operation: "CREATE",
          object: {
            metadata: { name: "test-pod" },
            spec: { containers: [] },
          },
        },
      };

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.apiVersion).toBe("admission.k8s.io/v1");
      expect(response.kind).toBe("AdmissionReview");
    });

    test("should preserve request UID in response", async () => {
      const request: AdmissionReviewRequest = {
        apiVersion: "admission.k8s.io/v1",
        kind: "AdmissionReview",
        request: {
          uid: "unique-uid-789",
          kind: { kind: "Pod", group: "", version: "v1" },
          resource: { group: "", version: "v1", resource: "pods" },
          operation: "CREATE",
          object: {
            metadata: { name: "test-pod" },
            spec: { containers: [] },
          },
        },
      };

      const response = await handleAdmissionReview(request, registryClient);

      expect(response.response.uid).toBe("unique-uid-789");
    });
  });
});
