import type { ImageReference } from "../types";

// Default registries mapping
const DEFAULT_REGISTRIES: Record<string, string> = {
  "docker.io": "registry-1.docker.io",
  "": "registry-1.docker.io", // Default when no registry specified
};

/**
 * Parse a container image reference into its components
 * Handles formats like:
 * - nginx (docker.io/library/nginx:latest)
 * - nginx:1.19 (docker.io/library/nginx:1.19)
 * - myrepo/nginx (docker.io/myrepo/nginx:latest)
 * - gcr.io/project/image:tag
 * - registry.example.com:5000/image:tag
 * - image@sha256:abc123...
 */
export function parseImageReference(image: string): ImageReference {
  let registry = "docker.io";
  let repository = image;
  let tag = "latest";
  let digest: string | undefined;

  // Check for digest
  if (repository.includes("@")) {
    const [repoWithoutDigest, digestPart] = repository.split("@");
    repository = repoWithoutDigest;
    digest = digestPart;
    tag = ""; // When digest is present, tag is ignored
  }

  // Check for tag (only if no digest)
  if (!digest && repository.includes(":")) {
    const lastColonIndex = repository.lastIndexOf(":");
    const potentialTag = repository.substring(lastColonIndex + 1);
    
    // Check if this is a port number (registry:port/image) or a tag
    // If there's a / after the colon, it's a port, not a tag
    if (!potentialTag.includes("/")) {
      tag = potentialTag;
      repository = repository.substring(0, lastColonIndex);
    }
  }

  // Check for registry (contains . or : or is localhost)
  const firstSlashIndex = repository.indexOf("/");
  if (firstSlashIndex !== -1) {
    const potentialRegistry = repository.substring(0, firstSlashIndex);
    
    if (
      potentialRegistry.includes(".") ||
      potentialRegistry.includes(":") ||
      potentialRegistry === "localhost"
    ) {
      registry = potentialRegistry;
      repository = repository.substring(firstSlashIndex + 1);
    }
  }

  // For Docker Hub, add library/ prefix for official images
  if ((registry === "docker.io" || registry === "registry-1.docker.io") && !repository.includes("/")) {
    repository = `library/${repository}`;
  }

  // Normalize registry
  const normalizedRegistry = DEFAULT_REGISTRIES[registry] || registry;

  return {
    registry: normalizedRegistry,
    repository,
    tag,
    digest,
    fullImage: image,
  };
}

/**
 * Get the registry API URL
 */
export function getRegistryApiUrl(registry: string, insecureRegistries: string[] = []): string {
  // Handle special cases
  if (registry === "docker.io" || registry === "registry-1.docker.io") {
    return "https://registry-1.docker.io";
  }
  
  if (registry === "gcr.io" || registry.endsWith(".gcr.io")) {
    return `https://${registry}`;
  }
  
  if (registry === "ghcr.io" || registry.endsWith(".pkg.github.com")) {
    return "https://ghcr.io";
  }

  // Default: assume HTTPS
  if (registry.startsWith("http://") || registry.startsWith("https://")) {
    return registry;
  }
  
  // Check if this registry is in the insecure list
  const normalizedRegistry = registry.toLowerCase();
  const isInsecure = insecureRegistries.some(insecure => 
    normalizedRegistry === insecure.toLowerCase() || 
    normalizedRegistry.startsWith(insecure.toLowerCase() + ":")
  );
  
  if (isInsecure) {
    return `http://${registry}`;
  }
  
  return `https://${registry}`;
}

/**
 * Get the authentication realm for a registry
 */
export function getAuthRealm(registry: string): string {
  if (registry === "docker.io" || registry === "registry-1.docker.io") {
    return "https://auth.docker.io/token";
  }
  
  if (registry === "gcr.io" || registry.endsWith(".gcr.io")) {
    return "https://gcr.io/v2/token";
  }
  
  if (registry === "ghcr.io" || registry.endsWith(".pkg.github.com")) {
    return "https://ghcr.io/token";
  }

  // For unknown registries, we'll discover it from WWW-Authenticate header
  return "";
}

/**
 * Parse WWW-Authenticate header to extract auth parameters
 */
export function parseWwwAuthenticate(header: string): {
  realm: string;
  service?: string;
  scope?: string;
} | null {
  // Format: Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/nginx:pull"
  const match = header.match(/Bearer\s+(.+)/i);
  if (!match) return null;

  const params: Record<string, string> = {};
  const regex = /(\w+)="([^"]+)"/g;
  let paramMatch;
  
  while ((paramMatch = regex.exec(match[1])) !== null) {
    params[paramMatch[1]] = paramMatch[2];
  }

  if (!params.realm) return null;

  return {
    realm: params.realm,
    service: params.service,
    scope: params.scope,
  };
}
