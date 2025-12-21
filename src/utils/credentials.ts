import type { RegistryCredentials, DockerConfigJson, RegistryAuthConfig } from "../types";

/**
 * Load registry credentials from environment variables or Kubernetes secrets
 */
export async function loadCredentials(): Promise<RegistryAuthConfig> {
  const credentials = new Map<string, RegistryCredentials>();

  // Load from environment variable (DOCKER_CONFIG_JSON)
  const dockerConfigJson = Bun.env.DOCKER_CONFIG_JSON;
  if (dockerConfigJson) {
    try {
      const config: DockerConfigJson = JSON.parse(dockerConfigJson);
      for (const [registry, auth] of Object.entries(config.auths)) {
        const creds = parseDockerAuth(registry, auth);
        if (creds) {
          credentials.set(normalizeRegistryHost(registry), creds);
        }
      }
    } catch (error) {
      console.error("Failed to parse DOCKER_CONFIG_JSON:", error);
    }
  }

  // Load individual registry credentials from env vars
  // Format: REGISTRY_<name>_URL, REGISTRY_<name>_USERNAME, REGISTRY_<name>_PASSWORD
  const registryNames = new Set<string>();
  for (const key of Object.keys(Bun.env)) {
    const match = key.match(/^REGISTRY_(.+)_(URL|USERNAME|PASSWORD|TOKEN)$/);
    if (match) {
      registryNames.add(match[1]);
    }
  }

  for (const name of registryNames) {
    const url = Bun.env[`REGISTRY_${name}_URL`];
    const username = Bun.env[`REGISTRY_${name}_USERNAME`];
    const password = Bun.env[`REGISTRY_${name}_PASSWORD`] || Bun.env[`REGISTRY_${name}_TOKEN`];

    if (url && username && password) {
      credentials.set(normalizeRegistryHost(url), {
        registry: url,
        username,
        password,
      });
    }
  }

  // Load default credentials
  let defaultCredentials: RegistryCredentials | undefined;
  const defaultUsername = Bun.env.DEFAULT_REGISTRY_USERNAME;
  const defaultPassword = Bun.env.DEFAULT_REGISTRY_PASSWORD || Bun.env.DEFAULT_REGISTRY_TOKEN;
  const defaultRegistry = Bun.env.DEFAULT_REGISTRY_URL || "docker.io";

  if (defaultUsername && defaultPassword) {
    defaultCredentials = {
      registry: defaultRegistry,
      username: defaultUsername,
      password: defaultPassword,
    };
  }

  return { credentials, defaultCredentials };
}

/**
 * Parse Docker auth configuration
 */
function parseDockerAuth(
  registry: string,
  auth: {
    username?: string;
    password?: string;
    auth?: string;
    email?: string;
  }
): RegistryCredentials | null {
  let username = auth.username;
  let password = auth.password;

  // If auth is base64 encoded username:password
  if (auth.auth && !username && !password) {
    try {
      const decoded = Buffer.from(auth.auth, "base64").toString("utf-8");
      const [user, ...passParts] = decoded.split(":");
      username = user;
      password = passParts.join(":"); // Handle passwords with colons
    } catch {
      return null;
    }
  }

  if (!username || !password) {
    return null;
  }

  return {
    registry,
    username,
    password,
  };
}

/**
 * Normalize registry hostname for matching
 */
export function normalizeRegistryHost(registry: string): string {
  // Remove protocol
  let host = registry.replace(/^https?:\/\//, "");
  
  // Remove trailing slash
  host = host.replace(/\/$/, "");
  
  // Handle Docker Hub aliases
  if (host === "docker.io" || host === "index.docker.io") {
    return "registry-1.docker.io";
  }
  
  return host;
}

/**
 * Get credentials for a specific registry
 */
export function getCredentialsForRegistry(
  config: RegistryAuthConfig,
  registry: string
): RegistryCredentials | undefined {
  const normalizedRegistry = normalizeRegistryHost(registry);
  
  // Try exact match
  if (config.credentials.has(normalizedRegistry)) {
    return config.credentials.get(normalizedRegistry);
  }

  // Try partial match (for subdomains like us.gcr.io matching gcr.io)
  for (const [key, creds] of config.credentials) {
    if (normalizedRegistry.endsWith(key) || key.endsWith(normalizedRegistry)) {
      return creds;
    }
  }

  // Return default credentials
  return config.defaultCredentials;
}

/**
 * Load credentials from a Kubernetes Secret (imagePullSecrets format)
 */
export function parseKubernetesDockerSecret(secretData: string): DockerConfigJson | null {
  try {
    // The secret is base64 encoded
    const decoded = Buffer.from(secretData, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}
