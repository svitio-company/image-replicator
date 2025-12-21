import { describe, test, expect, mock, beforeEach } from "bun:test";
import { RegistryClient } from "./registry-client";
import type { RegistryAuthConfig } from "../types";

describe("RegistryClient", () => {
  let authConfig: RegistryAuthConfig;

  beforeEach(() => {
    authConfig = {
      credentials: new Map([
        ["docker.io", { registry: "docker.io", username: "user", password: "pass" }],
        ["gcr.io", { registry: "gcr.io", username: "gcr_user", password: "gcr_pass" }],
      ]),
      defaultCredentials: {
        registry: "docker.io",
        username: "default",
        password: "defaultpass",
      },
    };
  });

  describe("constructor", () => {
    test("should create client with auth config", () => {
      const client = new RegistryClient(authConfig);
      expect(client).toBeDefined();
      expect(client.getTargetRegistry()).toBeUndefined();
    });

    test("should create client with target registry", () => {
      const client = new RegistryClient(authConfig, "myregistry.azurecr.io");
      expect(client.getTargetRegistry()).toBe("myregistry.azurecr.io");
    });

    test("should accept custom timeout", () => {
      const client = new RegistryClient(authConfig, undefined, 60000);
      expect(client).toBeDefined();
    });
  });

  describe("getTargetRegistry", () => {
    test("should return undefined when no target registry set", () => {
      const client = new RegistryClient(authConfig);
      expect(client.getTargetRegistry()).toBeUndefined();
    });

    test("should return target registry when set", () => {
      const client = new RegistryClient(authConfig, "myregistry.io");
      expect(client.getTargetRegistry()).toBe("myregistry.io");
    });
  });

  describe("clearTokenCache", () => {
    test("should clear token cache without errors", () => {
      const client = new RegistryClient(authConfig);
      expect(() => client.clearTokenCache()).not.toThrow();
    });
  });

  describe("checkImages", () => {
    test("should remove duplicate images", async () => {
      const client = new RegistryClient(authConfig);
      
      // Mock checkImageExists to track calls
      const checkSpy = mock(() => Promise.resolve({ 
        image: "nginx:latest", 
        exists: true, 
        registry: "registry-1.docker.io" 
      }));
      
      client.checkImageExists = checkSpy;

      await client.checkImages(["nginx:latest", "nginx:latest", "redis:7"]);
      
      // Should only call twice for unique images
      expect(checkSpy).toHaveBeenCalledTimes(2);
    });

    test("should check multiple images in parallel", async () => {
      const client = new RegistryClient(authConfig);
      
      const mockResults = [
        { image: "nginx:latest", exists: true, registry: "registry-1.docker.io" },
        { image: "redis:7", exists: true, registry: "registry-1.docker.io" },
      ];
      
      let callIndex = 0;
      client.checkImageExists = mock(() => Promise.resolve(mockResults[callIndex++]));

      const results = await client.checkImages(["nginx:latest", "redis:7"]);
      
      expect(results).toHaveLength(2);
      expect(results[0].image).toBe("nginx:latest");
      expect(results[1].image).toBe("redis:7");
    });
  });
});

describe("RegistryClient - Image Reference Parsing", () => {
  let authConfig: RegistryAuthConfig;

  beforeEach(() => {
    authConfig = {
      credentials: new Map(),
    };
  });

  describe("checkImageExists", () => {
    test("should parse simple image name", async () => {
      const client = new RegistryClient(authConfig);
      
      // Mock fetch to avoid actual network calls
      global.fetch = mock(() => 
        Promise.resolve(new Response(null, { status: 404 }))
      ) as any;

      const result = await client.checkImageExists("nginx");
      
      expect(result.image).toBe("nginx");
      expect(result.registry).toBe("registry-1.docker.io");
    });

    test("should parse image with tag", async () => {
      const client = new RegistryClient(authConfig);
      
      global.fetch = mock(() => 
        Promise.resolve(new Response(null, { status: 404 }))
      ) as any;

      const result = await client.checkImageExists("nginx:1.19");
      
      expect(result.image).toBe("nginx:1.19");
      expect(result.registry).toBe("registry-1.docker.io");
    });

    test("should parse GCR image", async () => {
      const client = new RegistryClient(authConfig);
      
      global.fetch = mock(() => 
        Promise.resolve(new Response(null, { status: 404 }))
      ) as any;

      const result = await client.checkImageExists("gcr.io/project/image:tag");
      
      expect(result.image).toBe("gcr.io/project/image:tag");
      expect(result.registry).toBe("gcr.io");
    });

    test("should parse image with digest", async () => {
      const client = new RegistryClient(authConfig);
      
      global.fetch = mock(() => 
        Promise.resolve(new Response(null, { status: 404 }))
      ) as any;

      const result = await client.checkImageExists("nginx@sha256:abc123");
      
      expect(result.image).toBe("nginx@sha256:abc123");
      expect(result.registry).toBe("registry-1.docker.io");
    });
  });

  describe("checkImageExists with target registry", () => {
    test("should check target registry when configured", async () => {
      const client = new RegistryClient(authConfig, "myregistry.io");
      
      global.fetch = mock(() => 
        Promise.resolve(new Response(null, { status: 404 }))
      ) as any;

      const result = await client.checkImageExists("nginx:latest");
      
      // Should check in target registry, not source
      expect(result.registry).toBe("myregistry.io");
    });

    test("should handle digest-based images in target registry", async () => {
      const client = new RegistryClient(authConfig, "myregistry.io");
      
      global.fetch = mock(() => 
        Promise.resolve(new Response(null, { status: 404 }))
      ) as any;

      const result = await client.checkImageExists("nginx@sha256:abc123def456");
      
      expect(result.registry).toBe("myregistry.io");
    });
  });

  describe("error handling", () => {
    test("should handle network errors gracefully", async () => {
      const client = new RegistryClient(authConfig);
      
      global.fetch = mock(() => 
        Promise.reject(new TypeError("Network error"))
      ) as any;

      const result = await client.checkImageExists("nginx:latest");
      
      expect(result.exists).toBe(false);
      expect(result.error).toContain("Network error");
    });

    test("should handle timeout errors", async () => {
      const client = new RegistryClient(authConfig, undefined, 100);
      
      global.fetch = mock(() => {
        const error = new Error("Timeout");
        error.name = "AbortError";
        return Promise.reject(error);
      }) as any;

      const result = await client.checkImageExists("nginx:latest");
      
      expect(result.exists).toBe(false);
      expect(result.error).toContain("timed out");
    });

    test("should handle non-200/404 status codes", async () => {
      const client = new RegistryClient(authConfig);
      
      global.fetch = mock(() => 
        Promise.resolve(new Response(null, { status: 500, statusText: "Internal Server Error" }))
      ) as any;

      const result = await client.checkImageExists("nginx:latest");
      
      expect(result.exists).toBe(false);
      expect(result.error).toContain("500");
    });
  });
});
