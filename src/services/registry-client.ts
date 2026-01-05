import type {
  ImageReference,
  ImageValidationResult,
  RegistryAuthConfig,
  RegistryTokenResponse,
} from "../types";
import {
  parseImageReference,
  getRegistryApiUrl,
  parseWwwAuthenticate,
} from "../utils/image-parser";
import { getCredentialsForRegistry } from "../utils/credentials";
import { metrics, METRICS } from "./metrics";

/**
 * Registry client for checking image existence
 * Supports Docker Hub, GCR, GHCR, ACR, ECR, and generic registries
 */
export class RegistryClient {
  private tokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private authConfig: RegistryAuthConfig,
    private targetRegistry?: string,
    private timeout: number = 240000, // 4 minutes default
    private insecureRegistries: string[] = [] // Registries to use HTTP instead of HTTPS
  ) {}

  /**
   * Get the configured target registry
   */
  getTargetRegistry(): string | undefined {
    return this.targetRegistry;
  }

  /**
   * Check if an image exists in the registry
   * If targetRegistry is set, checks if the image exists in the target registry
   * (to determine if it needs to be cloned)
   */
  async checkImageExists(image: string): Promise<ImageValidationResult> {
    const imageRef = parseImageReference(image);
    console.debug(`checkImageExists for image: ${image}`);
    console.debug(`Parsed imageRef:`, JSON.stringify(imageRef, null, 2));

    // If target registry is set, check if image exists there (cloned version)
    if (this.targetRegistry) {
      // Build target image reference, handling both tags and digests
      const reference = imageRef.digest 
        ? `${this.targetRegistry}/${imageRef.repository}@${imageRef.digest}`
        : `${this.targetRegistry}/${imageRef.repository}:${imageRef.tag || "latest"}`;
      const targetRef = parseImageReference(reference);

      try {
        const exists = await this.verifyManifest(targetRef);
        return {
          image,
          exists,
          registry: targetRef.registry,
        };
      } catch (error) {
        return {
          image,
          exists: false,
          error: error instanceof Error ? error.message : String(error),
          registry: targetRef.registry,
        };
      }
    }

    // Otherwise, check the source registry
    try {
      const exists = await this.verifyManifest(imageRef);
      return {
        image,
        exists,
        registry: imageRef.registry,
      };
    } catch (error) {
      return {
        image,
        exists: false,
        error: error instanceof Error ? error.message : String(error),
        registry: imageRef.registry,
      };
    }
  }

  /**
   * Verify that a manifest exists for the image
   */
  private async verifyManifest(imageRef: ImageReference): Promise<boolean> {
    const startTime = Date.now();
    const registryUrl = getRegistryApiUrl(imageRef.registry, this.insecureRegistries);
    const reference = imageRef.digest || imageRef.tag || "latest";

    // Build the manifest URL
    const manifestUrl = `${registryUrl}/v2/${imageRef.repository}/manifests/${reference}`;
    console.debug(`verifyManifest URL: ${manifestUrl}`);

    try {
      // First, try without auth to see if we need authentication
      let response = await fetch(manifestUrl, {
        signal: AbortSignal.timeout(this.timeout),
        method: "HEAD",
        headers: {
          Accept: [
            "application/vnd.docker.distribution.manifest.v2+json",
            "application/vnd.docker.distribution.manifest.list.v2+json",
            "application/vnd.oci.image.manifest.v1+json",
            "application/vnd.oci.image.index.v1+json",
          ].join(", "),
        },
      });

      // If we get 401, we need to authenticate
      if (response.status === 401) {
        const wwwAuth = response.headers.get("WWW-Authenticate");
        if (wwwAuth) {
          const token = await this.getToken(imageRef, wwwAuth);
          if (token) {
            response = await fetch(manifestUrl, {
              signal: AbortSignal.timeout(this.timeout),
              method: "HEAD",
              headers: {
                Accept: [
                  "application/vnd.docker.distribution.manifest.v2+json",
                  "application/vnd.docker.distribution.manifest.list.v2+json",
                  "application/vnd.oci.image.manifest.v1+json",
                  "application/vnd.oci.image.index.v1+json",
                ].join(", "),
                Authorization: `Bearer ${token}`,
              },
            });
          }
        }
      }

      // 200 = exists, 404 = not found
      if (response.status === 200) {
        const duration = (Date.now() - startTime) / 1000;
        metrics.observeHistogram(METRICS.REGISTRY_REQUEST_DURATION, duration, {
          registry: imageRef.registry,
          status: "200",
        });
        return true;
      }

      if (response.status === 404) {
        const duration = (Date.now() - startTime) / 1000;
        metrics.observeHistogram(METRICS.REGISTRY_REQUEST_DURATION, duration, {
          registry: imageRef.registry,
          status: "404",
        });
        return false;
      }

      // Handle other errors with more context
      throw new Error(
        `Registry ${imageRef.registry} returned status ${response.status} for ${imageRef.repository}:${reference}: ${response.statusText}`
      );
    } catch (error) {
      // Handle timeout errors
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request to ${imageRef.registry} timed out after ${this.timeout}ms`);
      }
      
      // Handle network errors
      if (error instanceof TypeError) {
        throw new Error(`Network error connecting to ${imageRef.registry}: ${error.message}`);
      }
      
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Get an authentication token for the registry
   */
  private async getToken(
    imageRef: ImageReference,
    wwwAuthHeader: string
  ): Promise<string | null> {
    const authParams = parseWwwAuthenticate(wwwAuthHeader);
    if (!authParams) {
      console.warn("Could not parse WWW-Authenticate header:", wwwAuthHeader);
      return null;
    }

    // Build cache key
    const cacheKey = `${imageRef.registry}:${imageRef.repository}`;

    // Check cache
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      metrics.incrementCounter(METRICS.TOKEN_CACHE_HITS, {
        registry: imageRef.registry,
      });
      return cached.token;
    }

    metrics.incrementCounter(METRICS.TOKEN_CACHE_MISSES, {
      registry: imageRef.registry,
    });

    // Build token request URL
    const tokenUrl = new URL(authParams.realm);
    if (authParams.service) {
      tokenUrl.searchParams.set("service", authParams.service);
    }
    tokenUrl.searchParams.set("scope", `repository:${imageRef.repository}:pull`);

    // Get credentials for this registry
    const creds = getCredentialsForRegistry(this.authConfig, imageRef.registry);

    const headers: Record<string, string> = {};
    if (creds) {
      const auth = btoa(`${creds.username}:${creds.password}`);
      headers["Authorization"] = `Basic ${auth}`;
    }

    try {
      // Token requests should be fast - use shorter timeout (10s or configured timeout, whichever is smaller)
      const tokenTimeout = Math.min(10000, this.timeout);
      const response = await fetch(tokenUrl.toString(), { 
        headers,
        signal: AbortSignal.timeout(tokenTimeout),
      });

      if (!response.ok) {
        console.error(
          `Token request failed: ${response.status} ${response.statusText}`
        );
        return null;
      }

      const data = (await response.json()) as RegistryTokenResponse;
      const token = data.token || data.access_token;

      if (token) {
        // Cache the token (default 5 minutes if not specified)
        const expiresIn = data.expires_in || 300;
        this.tokenCache.set(cacheKey, {
          token,
          expiresAt: Date.now() + expiresIn * 1000 - 30000, // 30s buffer
        });
      }

      return token || null;
    } catch (error) {
      console.error("Failed to get token:", error);
      return null;
    }
  }

  /**
   * Check multiple images in parallel
   */
  async checkImages(images: string[]): Promise<ImageValidationResult[]> {
    const uniqueImages = [...new Set(images)];
    return Promise.all(uniqueImages.map((img) => this.checkImageExists(img)));
  }

  /**
   * Clear the token cache
   */
  clearTokenCache(): void {
    this.tokenCache.clear();
  }

  /**
   * Test connectivity to a registry
   */
  async testRegistryConnectivity(registry: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const registryUrl = getRegistryApiUrl(registry, this.insecureRegistries);
    const testUrl = `${registryUrl}/v2/`;
    
    console.debug(`Testing connectivity to ${registry} at ${testUrl}`);
    
    try {
      const response = await fetch(testUrl, {
        method: "GET",
        signal: AbortSignal.timeout(10000), // 10 second timeout for connectivity test
      });
      
      // Any response (even 401 Unauthorized) means we can connect
      if (response.status === 200 || response.status === 401) {
        console.debug(`✓ Successfully connected to ${registry} (status: ${response.status})`);
        return { success: true };
      }
      
      console.warn(`Registry ${registry} returned unexpected status: ${response.status}`);
      return { 
        success: false, 
        error: `Registry returned status ${response.status}: ${response.statusText}` 
      };
    } catch (error) {
      let errorMessage: string;
      
      if (error instanceof Error && error.name === "AbortError") {
        errorMessage = `Connection timeout after 10s`;
      } else if (error instanceof TypeError) {
        errorMessage = `Network error: ${error.message}`;
      } else {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      
      console.error(`✗ Failed to connect to ${registry}: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Clone an image from source to target registry
   */
  async cloneImage(sourceImage: string, targetRegistry: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const startTime = Date.now();
    const sourceRef = parseImageReference(sourceImage);
    console.debug(`cloneImage sourceImage: ${sourceImage}`);
    console.debug(`cloneImage sourceRef:`, JSON.stringify(sourceRef, null, 2));
    console.debug(`cloneImage targetRegistry: ${targetRegistry}`);
    
    // Build target image reference
    const targetImage = sourceRef.digest
      ? `${targetRegistry}/${sourceRef.repository}@${sourceRef.digest}`
      : `${targetRegistry}/${sourceRef.repository}:${sourceRef.tag || "latest"}`;
    const targetRef = parseImageReference(targetImage);
    console.debug(`cloneImage targetImage: ${targetImage}`);
    console.debug(`cloneImage targetRef:`, JSON.stringify(targetRef, null, 2));

    console.log(`Cloning ${sourceImage} -> ${targetImage}`);

    try {
      // Pre-flight connectivity checks
      console.debug(`Pre-flight: Testing connectivity to source registry ${sourceRef.registry}`);
      const sourceConnectivity = await this.testRegistryConnectivity(sourceRef.registry);
      if (!sourceConnectivity.success) {
        throw new Error(
          `Cannot connect to source registry ${sourceRef.registry}: ${sourceConnectivity.error}. ` +
          `Please check network connectivity, DNS resolution, and firewall rules.`
        );
      }
      
      console.debug(`Pre-flight: Testing connectivity to target registry ${targetRef.registry}`);
      const targetConnectivity = await this.testRegistryConnectivity(targetRef.registry);
      if (!targetConnectivity.success) {
        throw new Error(
          `Cannot connect to target registry ${targetRef.registry}: ${targetConnectivity.error}. ` +
          `Please check network connectivity, DNS resolution, and firewall rules.`
        );
      }
      
      console.debug(`Pre-flight checks passed, proceeding with image clone`);

      // 1. Get manifest from source
      const manifest = await this.getManifest(sourceRef);
      if (!manifest) {
        throw new Error("Failed to fetch source manifest");
      }

      // 2. Push manifest to target
      await this.pushManifest(targetRef, manifest);

      const duration = (Date.now() - startTime) / 1000;
      metrics.observeHistogram(METRICS.IMAGE_CLONE_DURATION, duration, {
        source_registry: sourceRef.registry,
        target_registry: targetRef.registry,
        status: "success",
      });
      metrics.incrementCounter(METRICS.IMAGE_CLONE_TOTAL, {
        source_registry: sourceRef.registry,
        target_registry: targetRef.registry,
        status: "success",
      });

      console.log(`Successfully cloned ${sourceImage} to ${targetImage}`);
      return { success: true };
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      metrics.observeHistogram(METRICS.IMAGE_CLONE_DURATION, duration, {
        source_registry: sourceRef.registry,
        target_registry: targetRef.registry,
        status: "error",
      });
      metrics.incrementCounter(METRICS.IMAGE_CLONE_TOTAL, {
        source_registry: sourceRef.registry,
        target_registry: targetRef.registry,
        status: "error",
      });

      console.error(`Failed to clone ${sourceImage}: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get manifest from source registry
   */
  private async getManifest(imageRef: ImageReference): Promise<string | null> {
    const registryUrl = getRegistryApiUrl(imageRef.registry, this.insecureRegistries);
    const reference = imageRef.digest || imageRef.tag || "latest";
    const manifestUrl = `${registryUrl}/v2/${imageRef.repository}/manifests/${reference}`;
    console.debug(`getManifest URL: ${manifestUrl}`);

    try {
      let response = await fetch(manifestUrl, {
        method: "GET",
        headers: {
          Accept: [
            "application/vnd.docker.distribution.manifest.v2+json",
            "application/vnd.docker.distribution.manifest.list.v2+json",
            "application/vnd.oci.image.manifest.v1+json",
            "application/vnd.oci.image.index.v1+json",
          ].join(", "),
        },
        signal: AbortSignal.timeout(this.timeout),
      });

      // Handle authentication
      if (response.status === 401) {
        const wwwAuth = response.headers.get("WWW-Authenticate");
        if (wwwAuth) {
          const token = await this.getToken(imageRef, wwwAuth);
          if (token) {
            response = await fetch(manifestUrl, {
              method: "GET",
              headers: {
                Accept: [
                  "application/vnd.docker.distribution.manifest.v2+json",
                  "application/vnd.docker.distribution.manifest.list.v2+json",
                  "application/vnd.oci.image.manifest.v1+json",
                  "application/vnd.oci.image.index.v1+json",
                ].join(", "),
                Authorization: `Bearer ${token}`,
              },
              signal: AbortSignal.timeout(this.timeout),
            });
          }
        }
      }

      if (!response.ok) {
        throw new Error(`Failed to get manifest: ${response.status} ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      // Handle timeout errors
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request to ${imageRef.registry} timed out after ${this.timeout}ms`);
      }
      
      // Handle network errors
      if (error instanceof TypeError) {
        throw new Error(`Network error connecting to ${imageRef.registry}: ${error.message}`);
      }
      
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Push manifest to target registry
   */
  private async pushManifest(imageRef: ImageReference, manifest: string): Promise<void> {
    const registryUrl = getRegistryApiUrl(imageRef.registry, this.insecureRegistries);
    const reference = imageRef.digest || imageRef.tag || "latest";
    const manifestUrl = `${registryUrl}/v2/${imageRef.repository}/manifests/${reference}`;

    // Parse manifest to get content type
    const manifestObj = JSON.parse(manifest);
    const contentType = manifestObj.mediaType || "application/vnd.docker.distribution.manifest.v2+json";

    try {
      let response = await fetch(manifestUrl, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
        },
        body: manifest,
        signal: AbortSignal.timeout(this.timeout),
      });

      // Handle authentication
      if (response.status === 401) {
        const wwwAuth = response.headers.get("WWW-Authenticate");
        if (wwwAuth) {
          const token = await this.getToken(imageRef, wwwAuth);
          if (token) {
            response = await fetch(manifestUrl, {
              method: "PUT",
              headers: {
                "Content-Type": contentType,
                Authorization: `Bearer ${token}`,
              },
              body: manifest,
              signal: AbortSignal.timeout(this.timeout),
            });
          }
        }
      }

      if (!response.ok) {
        throw new Error(`Failed to push manifest: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      // Handle timeout errors
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request to ${imageRef.registry} timed out after ${this.timeout}ms`);
      }
      
      // Handle network errors
      if (error instanceof TypeError) {
        throw new Error(`Network error connecting to ${imageRef.registry}: ${error.message}`);
      }
      
      // Re-throw other errors
      throw error;
    }
  }
}
