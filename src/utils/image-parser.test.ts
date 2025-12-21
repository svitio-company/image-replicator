import { describe, test, expect } from "bun:test";
import { parseImageReference, getRegistryApiUrl, parseWwwAuthenticate } from "./image-parser";

describe("parseImageReference", () => {
  test("should parse simple image name", () => {
    const result = parseImageReference("nginx");
    expect(result.registry).toBe("registry-1.docker.io");
    expect(result.repository).toBe("library/nginx");
    expect(result.tag).toBe("latest");
    expect(result.digest).toBeUndefined();
  });

  test("should parse image with tag", () => {
    const result = parseImageReference("nginx:1.19");
    expect(result.registry).toBe("registry-1.docker.io");
    expect(result.repository).toBe("library/nginx");
    expect(result.tag).toBe("1.19");
  });

  test("should parse image with repository", () => {
    const result = parseImageReference("myorg/myapp:v1.0");
    expect(result.registry).toBe("registry-1.docker.io");
    expect(result.repository).toBe("myorg/myapp");
    expect(result.tag).toBe("v1.0");
  });

  test("should parse GCR image", () => {
    const result = parseImageReference("gcr.io/project/image:tag");
    expect(result.registry).toBe("gcr.io");
    expect(result.repository).toBe("project/image");
    expect(result.tag).toBe("tag");
  });

  test("should parse GHCR image", () => {
    const result = parseImageReference("ghcr.io/owner/repo:latest");
    expect(result.registry).toBe("ghcr.io");
    expect(result.repository).toBe("owner/repo");
    expect(result.tag).toBe("latest");
  });

  test("should parse ACR image", () => {
    const result = parseImageReference("myregistry.azurecr.io/myapp:v1");
    expect(result.registry).toBe("myregistry.azurecr.io");
    expect(result.repository).toBe("myapp");
    expect(result.tag).toBe("v1");
  });

  test("should parse image with digest", () => {
    const result = parseImageReference("nginx@sha256:abc123");
    expect(result.registry).toBe("registry-1.docker.io");
    expect(result.repository).toBe("library/nginx");
    expect(result.digest).toBe("sha256:abc123");
    expect(result.tag).toBe("");
  });

  test("should parse image with registry and port", () => {
    const result = parseImageReference("localhost:5000/myapp:latest");
    expect(result.registry).toBe("localhost:5000");
    expect(result.repository).toBe("myapp");
    expect(result.tag).toBe("latest");
  });

  test("should handle nested repository paths", () => {
    const result = parseImageReference("gcr.io/project/team/app:v1");
    expect(result.registry).toBe("gcr.io");
    expect(result.repository).toBe("project/team/app");
    expect(result.tag).toBe("v1");
  });
});

describe("getRegistryApiUrl", () => {
  test("should return Docker Hub URL", () => {
    expect(getRegistryApiUrl("registry-1.docker.io")).toBe("https://registry-1.docker.io");
    expect(getRegistryApiUrl("docker.io")).toBe("https://registry-1.docker.io");
  });

  test("should return GCR URL", () => {
    expect(getRegistryApiUrl("gcr.io")).toBe("https://gcr.io");
    expect(getRegistryApiUrl("us.gcr.io")).toBe("https://us.gcr.io");
  });

  test("should return GHCR URL", () => {
    expect(getRegistryApiUrl("ghcr.io")).toBe("https://ghcr.io");
  });

  test("should add https for unknown registries", () => {
    expect(getRegistryApiUrl("myregistry.azurecr.io")).toBe("https://myregistry.azurecr.io");
  });

  test("should preserve existing protocol", () => {
    expect(getRegistryApiUrl("https://registry.example.com")).toBe("https://registry.example.com");
    expect(getRegistryApiUrl("http://localhost:5000")).toBe("http://localhost:5000");
  });
});

describe("parseWwwAuthenticate", () => {
  test("should parse Docker Hub WWW-Authenticate header", () => {
    const header = 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/nginx:pull"';
    const result = parseWwwAuthenticate(header);
    
    expect(result).toBeDefined();
    expect(result?.realm).toBe("https://auth.docker.io/token");
    expect(result?.service).toBe("registry.docker.io");
    expect(result?.scope).toBe("repository:library/nginx:pull");
  });

  test("should handle missing service", () => {
    const header = 'Bearer realm="https://auth.example.com/token"';
    const result = parseWwwAuthenticate(header);
    
    expect(result).toBeDefined();
    expect(result?.realm).toBe("https://auth.example.com/token");
    expect(result?.service).toBeUndefined();
  });

  test("should return null for invalid header", () => {
    expect(parseWwwAuthenticate("Basic realm=test")).toBeNull();
    expect(parseWwwAuthenticate("Invalid")).toBeNull();
    expect(parseWwwAuthenticate("")).toBeNull();
  });

  test("should handle case insensitive Bearer", () => {
    const header = 'bearer realm="https://auth.example.com/token"';
    const result = parseWwwAuthenticate(header);
    
    expect(result).toBeDefined();
    expect(result?.realm).toBe("https://auth.example.com/token");
  });
});
