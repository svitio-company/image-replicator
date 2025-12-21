// Registry Types

export interface RegistryCredentials {
  username: string;
  password: string; // Can be a token
  registry: string;
}

export interface ImageReference {
  registry: string;
  repository: string;
  tag: string;
  digest?: string;
  fullImage: string;
}

export interface ImageValidationResult {
  image: string;
  exists: boolean;
  error?: string;
  registry: string;
}

export interface DockerConfigJson {
  auths: {
    [registry: string]: {
      username?: string;
      password?: string;
      auth?: string; // base64 encoded username:password
      email?: string;
    };
  };
}

export interface RegistryAuthConfig {
  // Map of registry hostname to credentials
  credentials: Map<string, RegistryCredentials>;
  // Default credentials for unknown registries
  defaultCredentials?: RegistryCredentials;
}

// Docker Registry API Types
export interface RegistryTokenResponse {
  token: string;
  access_token?: string;
  expires_in?: number;
  issued_at?: string;
}

export interface RegistryErrorResponse {
  errors: Array<{
    code: string;
    message: string;
    detail?: unknown;
  }>;
}

export interface ManifestResponse {
  schemaVersion: number;
  mediaType?: string;
  config?: {
    mediaType: string;
    size: number;
    digest: string;
  };
  layers?: Array<{
    mediaType: string;
    size: number;
    digest: string;
  }>;
}
