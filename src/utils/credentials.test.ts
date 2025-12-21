import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadCredentials, normalizeRegistryHost, getCredentialsForRegistry } from "./credentials";
import type { RegistryAuthConfig } from "../types";

describe("normalizeRegistryHost", () => {
  test("should remove https:// prefix", () => {
    expect(normalizeRegistryHost("https://myregistry.io")).toBe("myregistry.io");
  });

  test("should remove http:// prefix", () => {
    expect(normalizeRegistryHost("http://myregistry.io")).toBe("myregistry.io");
  });

  test("should remove trailing slash", () => {
    expect(normalizeRegistryHost("myregistry.io/")).toBe("myregistry.io");
  });

  test("should normalize docker.io to registry-1.docker.io", () => {
    expect(normalizeRegistryHost("docker.io")).toBe("registry-1.docker.io");
    expect(normalizeRegistryHost("index.docker.io")).toBe("registry-1.docker.io");
  });

  test("should handle complex URL", () => {
    expect(normalizeRegistryHost("https://myregistry.io/")).toBe("myregistry.io");
  });

  test("should keep plain hostname unchanged", () => {
    expect(normalizeRegistryHost("gcr.io")).toBe("gcr.io");
    expect(normalizeRegistryHost("ghcr.io")).toBe("ghcr.io");
  });
});

describe("getCredentialsForRegistry", () => {
  test("should return exact match", () => {
    const config: RegistryAuthConfig = {
      credentials: new Map([
        ["gcr.io", { registry: "gcr.io", username: "user", password: "pass" }],
        ["ghcr.io", { registry: "ghcr.io", username: "user2", password: "pass2" }],
      ]),
    };

    const creds = getCredentialsForRegistry(config, "gcr.io");
    expect(creds?.registry).toBe("gcr.io");
    expect(creds?.username).toBe("user");
  });

  test("should return default credentials when no match found", () => {
    const config: RegistryAuthConfig = {
      credentials: new Map(),
      defaultCredentials: {
        registry: "docker.io",
        username: "default-user",
        password: "default-pass",
      },
    };

    const creds = getCredentialsForRegistry(config, "unknown.io");
    expect(creds?.registry).toBe("docker.io");
    expect(creds?.username).toBe("default-user");
  });

  test("should return undefined when no match and no default", () => {
    const config: RegistryAuthConfig = {
      credentials: new Map(),
    };

    const creds = getCredentialsForRegistry(config, "unknown.io");
    expect(creds).toBeUndefined();
  });

  test("should handle normalized registry names", () => {
    const config: RegistryAuthConfig = {
      credentials: new Map([
        ["registry-1.docker.io", { registry: "docker.io", username: "user", password: "pass" }],
      ]),
    };

    const creds = getCredentialsForRegistry(config, "docker.io");
    expect(creds?.username).toBe("user");
  });

  test("should match subdomain registries", () => {
    const config: RegistryAuthConfig = {
      credentials: new Map([
        ["gcr.io", { registry: "gcr.io", username: "user", password: "pass" }],
      ]),
    };

    const creds = getCredentialsForRegistry(config, "us.gcr.io");
    expect(creds?.username).toBe("user");
  });
});

describe("loadCredentials", () => {
  const originalEnv: Record<string, string> = {};

  beforeEach(() => {
    // Save original env vars
    for (const key of Object.keys(Bun.env)) {
      if (key.startsWith("REGISTRY_") || key.startsWith("DEFAULT_") || key === "DOCKER_CONFIG_JSON") {
        originalEnv[key] = Bun.env[key] || "";
        delete Bun.env[key];
      }
    }
  });

  afterEach(() => {
    // Restore original env vars
    for (const key of Object.keys(originalEnv)) {
      if (originalEnv[key]) {
        Bun.env[key] = originalEnv[key];
      } else {
        delete Bun.env[key];
      }
    }
  });

  test("should load credentials from DOCKER_CONFIG_JSON", async () => {
    Bun.env.DOCKER_CONFIG_JSON = JSON.stringify({
      auths: {
        "docker.io": {
          username: "dockeruser",
          password: "dockerpass",
        },
        "ghcr.io": {
          username: "ghcruser",
          password: "ghcrpass",
        },
      },
    });

    const config = await loadCredentials();
    expect(config.credentials.size).toBe(2);
    
    const dockerCreds = config.credentials.get("registry-1.docker.io");
    expect(dockerCreds?.username).toBe("dockeruser");
    
    const ghcrCreds = config.credentials.get("ghcr.io");
    expect(ghcrCreds?.username).toBe("ghcruser");
  });

  test("should load credentials from base64 encoded auth field", async () => {
    const authString = Buffer.from("user:pass").toString("base64");
    Bun.env.DOCKER_CONFIG_JSON = JSON.stringify({
      auths: {
        "gcr.io": {
          auth: authString,
        },
      },
    });

    const config = await loadCredentials();
    const creds = config.credentials.get("gcr.io");
    expect(creds?.username).toBe("user");
    expect(creds?.password).toBe("pass");
  });

  test("should handle passwords with colons", async () => {
    const authString = Buffer.from("user:pass:with:colons").toString("base64");
    Bun.env.DOCKER_CONFIG_JSON = JSON.stringify({
      auths: {
        "gcr.io": {
          auth: authString,
        },
      },
    });

    const config = await loadCredentials();
    const creds = config.credentials.get("gcr.io");
    expect(creds?.username).toBe("user");
    expect(creds?.password).toBe("pass:with:colons");
  });

  test("should load individual registry credentials from env vars", async () => {
    Bun.env.REGISTRY_MYREGISTRY_URL = "myregistry.azurecr.io";
    Bun.env.REGISTRY_MYREGISTRY_USERNAME = "admin";
    Bun.env.REGISTRY_MYREGISTRY_PASSWORD = "adminpass";

    const config = await loadCredentials();
    const creds = config.credentials.get("myregistry.azurecr.io");
    expect(creds?.username).toBe("admin");
    expect(creds?.password).toBe("adminpass");
  });

  test("should support token instead of password", async () => {
    Bun.env.REGISTRY_GITHUB_URL = "ghcr.io";
    Bun.env.REGISTRY_GITHUB_USERNAME = "myuser";
    Bun.env.REGISTRY_GITHUB_TOKEN = "ghp_token123";

    const config = await loadCredentials();
    const creds = config.credentials.get("ghcr.io");
    expect(creds?.username).toBe("myuser");
    expect(creds?.password).toBe("ghp_token123");
  });

  test("should load default credentials", async () => {
    Bun.env.DEFAULT_REGISTRY_URL = "docker.io";
    Bun.env.DEFAULT_REGISTRY_USERNAME = "defaultuser";
    Bun.env.DEFAULT_REGISTRY_PASSWORD = "defaultpass";

    const config = await loadCredentials();
    expect(config.defaultCredentials?.registry).toBe("docker.io");
    expect(config.defaultCredentials?.username).toBe("defaultuser");
    expect(config.defaultCredentials?.password).toBe("defaultpass");
  });

  test("should prefer token over password for default credentials", async () => {
    Bun.env.DEFAULT_REGISTRY_URL = "docker.io";
    Bun.env.DEFAULT_REGISTRY_USERNAME = "defaultuser";
    Bun.env.DEFAULT_REGISTRY_PASSWORD = "oldpass";
    Bun.env.DEFAULT_REGISTRY_TOKEN = "newtoken";

    const config = await loadCredentials();
    expect(config.defaultCredentials?.password).toBe("newtoken");
  });

  test("should default to docker.io if no default URL specified", async () => {
    Bun.env.DEFAULT_REGISTRY_USERNAME = "defaultuser";
    Bun.env.DEFAULT_REGISTRY_PASSWORD = "defaultpass";

    const config = await loadCredentials();
    expect(config.defaultCredentials?.registry).toBe("docker.io");
  });

  test("should return empty config when no credentials provided", async () => {
    const config = await loadCredentials();
    expect(config.credentials.size).toBe(0);
    expect(config.defaultCredentials).toBeUndefined();
  });

  test("should skip incomplete registry credentials", async () => {
    Bun.env.REGISTRY_INCOMPLETE_URL = "incomplete.io";
    Bun.env.REGISTRY_INCOMPLETE_USERNAME = "user";
    // Missing PASSWORD

    const config = await loadCredentials();
    expect(config.credentials.has("incomplete.io")).toBe(false);
  });

  test("should handle malformed DOCKER_CONFIG_JSON gracefully", async () => {
    Bun.env.DOCKER_CONFIG_JSON = "not valid json";

    const config = await loadCredentials();
    expect(config.credentials.size).toBe(0);
  });

  test("should combine multiple credential sources", async () => {
    Bun.env.DOCKER_CONFIG_JSON = JSON.stringify({
      auths: {
        "docker.io": {
          username: "dockeruser",
          password: "dockerpass",
        },
      },
    });
    Bun.env.REGISTRY_AZURE_URL = "myregistry.azurecr.io";
    Bun.env.REGISTRY_AZURE_USERNAME = "azureuser";
    Bun.env.REGISTRY_AZURE_PASSWORD = "azurepass";
    Bun.env.DEFAULT_REGISTRY_USERNAME = "defaultuser";
    Bun.env.DEFAULT_REGISTRY_PASSWORD = "defaultpass";

    const config = await loadCredentials();
    expect(config.credentials.size).toBe(2);
    expect(config.credentials.has("registry-1.docker.io")).toBe(true);
    expect(config.credentials.has("myregistry.azurecr.io")).toBe(true);
    expect(config.defaultCredentials?.username).toBe("defaultuser");
  });
});
