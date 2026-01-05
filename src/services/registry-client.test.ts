import { describe, test, expect, mock, beforeEach, spyOn } from "bun:test";
import { RegistryClient } from "./registry-client";
import type { RegistryAuthConfig } from "../types";

// Mock Bun.spawn for all tests
const mockSpawn = (exitCode: number, stdout = "", stderr = "") => {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new Response(stdout).body,
    stderr: new Response(stderr).body,
    kill: mock(() => {}),
  } as any;
};

describe("RegistryClient", () => {
  let authConfig: RegistryAuthConfig;
  let originalSpawn: typeof Bun.spawn;

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
    originalSpawn = Bun.spawn;
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

describe("RegistryClient - Skopeo Integration", () => {
  let authConfig: RegistryAuthConfig;
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    authConfig = {
      credentials: new Map([
        ["docker.io", { registry: "docker.io", username: "user", password: "pass" }],
      ]),
    };
    originalSpawn = Bun.spawn;
  });

  describe("checkImageExists", () => {
    test("should call skopeo inspect for image verification", async () => {
      const client = new RegistryClient(authConfig);
      
      Bun.spawn = mock((args: any) => {
        expect(args[0]).toBe("skopeo");
        expect(args[1]).toBe("inspect");
        return mockSpawn(0, JSON.stringify({ Name: "nginx" }));
      }) as any;

      const result = await client.checkImageExists("nginx:latest");
      
      expect(result.exists).toBe(true);
      expect(result.registry).toBe("registry-1.docker.io");
      
      Bun.spawn = originalSpawn;
    });

    test("should handle image not found (404)", async () => {
      const client = new RegistryClient(authConfig);
      
      Bun.spawn = mock(() => {
        return mockSpawn(1, "", "manifest unknown: manifest not found");
      }) as any;

      const result = await client.checkImageExists("nonexistent:latest");
      
      expect(result.exists).toBe(false);
      
      Bun.spawn = originalSpawn;
    });

    test("should pass credentials to skopeo", async () => {
      const client = new RegistryClient(authConfig);
      
      Bun.spawn = mock((args: any) => {
        const argsArray = Array.isArray(args) ? args : [args];
        expect(argsArray).toContain("--creds");
        expect(argsArray).toContain("user:pass");
        return mockSpawn(0, JSON.stringify({ Name: "nginx" }));
      }) as any;

      await client.checkImageExists("nginx:latest");
      
      Bun.spawn = originalSpawn;
    });

    test("should handle target registry when configured", async () => {
      const client = new RegistryClient(authConfig, "myregistry.io");
      
      Bun.spawn = mock((args: any) => {
        const argsArray = Array.isArray(args) ? args : [args];
        const dockerArg = argsArray.find((arg: string) => arg?.startsWith?.("docker://"));
        expect(dockerArg).toContain("myregistry.io");
        return mockSpawn(0, JSON.stringify({ Name: "nginx" }));
      }) as any;

      const result = await client.checkImageExists("nginx:latest");
      expect(result.registry).toBe("myregistry.io");
      
      Bun.spawn = originalSpawn;
    });

    test("should handle digest-based images", async () => {
      const client = new RegistryClient(authConfig);
      
      Bun.spawn = mock((args: any) => {
        const argsArray = Array.isArray(args) ? args : [args];
        const dockerArg = argsArray.find((arg: string) => arg?.includes?.("@sha256:"));
        expect(dockerArg).toBeDefined();
        return mockSpawn(0, JSON.stringify({ Name: "nginx" }));
      }) as any;

      await client.checkImageExists("nginx@sha256:abc123");
      
      Bun.spawn = originalSpawn;
    });
  });

  describe("cloneImage", () => {
    test("should call skopeo copy with correct arguments", async () => {
      const client = new RegistryClient(authConfig);
      
      let inspectCalls = 0;
      let copyCalled = false;
      
      Bun.spawn = mock((args: any) => {
        const argsArray = Array.isArray(args) ? args : [args];
        
        if (argsArray.includes("inspect")) {
          inspectCalls++;
          return mockSpawn(0, JSON.stringify({ Name: "test" }));
        }
        
        if (argsArray.includes("copy")) {
          copyCalled = true;
          expect(argsArray).toContain("docker://nginx:latest");
          expect(argsArray).toContain("docker://myregistry.io/library/nginx:latest");
          expect(argsArray).toContain("--all");
          return mockSpawn(0);
        }
        
        return mockSpawn(0);
      }) as any;

      const result = await client.cloneImage("nginx:latest", "myregistry.io");
      
      expect(result.success).toBe(true);
      expect(copyCalled).toBe(true);
      
      Bun.spawn = originalSpawn;
    });

    test("should pass source and destination credentials", async () => {
      const authConfigWithTarget = {
        credentials: new Map([
          ["docker.io", { registry: "docker.io", username: "sourceuser", password: "sourcepass" }],
          ["myregistry.io", { registry: "myregistry.io", username: "targetuser", password: "targetpass" }],
        ]),
      };
      
      const client = new RegistryClient(authConfigWithTarget);
      
      let copyArgs: string[] = [];
      
      Bun.spawn = mock((args: any) => {
        const argsArray = Array.isArray(args) ? args : [args];
        
        if (argsArray.includes("copy")) {
          copyArgs = argsArray;
          return mockSpawn(0);
        }
        
        return mockSpawn(0, JSON.stringify({ Name: "test" }));
      }) as any;

      await client.cloneImage("nginx:latest", "myregistry.io");
      
      expect(copyArgs).toContain("--src-creds");
      expect(copyArgs).toContain("sourceuser:sourcepass");
      expect(copyArgs).toContain("--dest-creds");
      expect(copyArgs).toContain("targetuser:targetpass");
      
      Bun.spawn = originalSpawn;
    });

    test("should handle clone errors", async () => {
      const client = new RegistryClient(authConfig);
      
      Bun.spawn = mock((args: any) => {
        const argsArray = Array.isArray(args) ? args : [args];
        
        if (argsArray.includes("copy")) {
          return mockSpawn(1, "", "Error copying image: authentication failed");
        }
        
        return mockSpawn(0, JSON.stringify({ Name: "test" }));
      }) as any;

      const result = await client.cloneImage("nginx:latest", "myregistry.io");
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("authentication failed");
      
      Bun.spawn = originalSpawn;
    });
  });

  describe("testRegistryConnectivity", () => {
    test("should test connectivity with skopeo", async () => {
      const client = new RegistryClient(authConfig);
      
      Bun.spawn = mock(() => {
        return mockSpawn(0, JSON.stringify({ Name: "test" }));
      }) as any;

      const result = await client.testRegistryConnectivity("docker.io");
      
      expect(result.success).toBe(true);
      
      Bun.spawn = originalSpawn;
    });

    test("should handle connectivity errors", async () => {
      const client = new RegistryClient(authConfig);
      
      Bun.spawn = mock(() => {
        return mockSpawn(1, "", "connection refused");
      }) as any;

      const result = await client.testRegistryConnectivity("unreachable.io");
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("connection");
      
      Bun.spawn = originalSpawn;
    });

    test("should treat image not found as successful connectivity", async () => {
      const client = new RegistryClient(authConfig);
      
      Bun.spawn = mock(() => {
        return mockSpawn(1, "", "manifest unknown: not found");
      }) as any;

      const result = await client.testRegistryConnectivity("docker.io");
      
      expect(result.success).toBe(true);
      
      Bun.spawn = originalSpawn;
    });
  });

  describe("security - credential sanitization", () => {
    test("should not log passwords in clear text", async () => {
      const authConfigWithCreds = {
        credentials: new Map([
          ["docker.io", { registry: "docker.io", username: "testuser", password: "secretpassword123" }],
          ["myregistry.io", { registry: "myregistry.io", username: "targetuser", password: "topsecret456" }],
        ]),
      };
      
      const client = new RegistryClient(authConfigWithCreds);
      
      // Enable debug logging temporarily
      const { logger } = await import("../utils/logger");
      const wasDebugEnabled = (logger as any).debugEnabled;
      logger.setDebugEnabled(true);
      
      // Capture debug logs
      const debugLogs: any[] = [];
      const originalDebug = console.debug;
      console.debug = mock((msg: string) => {
        debugLogs.push(msg);
      }) as any;
      
      Bun.spawn = mock(() => {
        return mockSpawn(0);
      }) as any;

      await client.cloneImage("nginx:latest", "myregistry.io");
      
      // Restore console and logger state
      console.debug = originalDebug;
      logger.setDebugEnabled(wasDebugEnabled);
      
      // Check that passwords are not in the logs
      const allLogs = debugLogs.join(" ");
      expect(allLogs).not.toContain("secretpassword123");
      expect(allLogs).not.toContain("topsecret456");
      
      // But usernames should still be visible for debugging
      expect(allLogs).toContain("testuser");
      expect(allLogs).toContain("targetuser");
      
      // And passwords should be masked
      expect(allLogs).toContain("***");
      
      Bun.spawn = originalSpawn;
    });
  });
});
