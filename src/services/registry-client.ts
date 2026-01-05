import type {
  ImageReference,
  ImageValidationResult,
  RegistryAuthConfig,
} from "../types";
import { parseImageReference } from "../utils/image-parser";
import { getCredentialsForRegistry } from "../utils/credentials";
import { metrics, METRICS } from "./metrics";
import { logger } from "../utils/logger";

/**
 * Sanitize command arguments for logging by masking credentials
 */
function sanitizeArgs(args: string[]): string {
  const sanitized = [...args];
  const credsFlags = ["--creds", "--src-creds", "--dest-creds"];
  
  for (let i = 0; i < sanitized.length; i++) {
    if (credsFlags.includes(sanitized[i]) && i + 1 < sanitized.length) {
      // Mask the password part, keep username for debugging
      const creds = sanitized[i + 1];
      const colonIndex = creds.indexOf(":");
      if (colonIndex > 0) {
        sanitized[i + 1] = creds.substring(0, colonIndex + 1) + "***";
      } else {
        sanitized[i + 1] = "***";
      }
    }
  }
  
  return sanitized.join(" ");
}

/**
 * Registry client using Skopeo for container image operations
 * Skopeo provides battle-tested, production-ready image manipulation
 * Supports Docker Hub, GCR, GHCR, ACR, ECR, and generic registries
 */
export class RegistryClient {
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
    logger.debug("Checking image existence", { image, registry: imageRef.registry, repository: imageRef.repository });

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
   * Verify that a manifest exists for the image using skopeo inspect
   */
  private async verifyManifest(imageRef: ImageReference): Promise<boolean> {
    const startTime = Date.now();
    const reference = imageRef.digest || imageRef.tag || "latest";
    
    // Build full image reference for skopeo
    const fullImage = imageRef.digest
      ? `${imageRef.registry}/${imageRef.repository}@${imageRef.digest}`
      : `${imageRef.registry}/${imageRef.repository}:${reference}`;

    logger.debug("Verifying manifest with skopeo", { fullImage, registry: imageRef.registry });

    try {
      const args = ["inspect", `docker://${fullImage}`];
      
      // Add credentials if available
      const creds = getCredentialsForRegistry(this.authConfig, imageRef.registry);
      if (creds) {
        args.push("--creds", `${creds.username}:${creds.password}`);
      }

      // Add insecure flag if registry is in the insecure list
      if (this.insecureRegistries.includes(imageRef.registry)) {
        args.push("--tls-verify=false");
      }

      const proc = Bun.spawn(["skopeo", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });

      // Wait for process to complete with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), this.timeout);
      });

      const result = await Promise.race([proc.exited, timeoutPromise]);

      if (result === 0) {
        const duration = (Date.now() - startTime) / 1000;
        metrics.observeHistogram(METRICS.REGISTRY_REQUEST_DURATION, duration, {
          registry: imageRef.registry,
          status: "200",
        });
        return true;
      }

      // Read stderr for error details
      const stderr = await new Response(proc.stderr).text();
      
      // 404-like errors - image not found
      if (stderr.includes("manifest unknown") || stderr.includes("not found")) {
        const duration = (Date.now() - startTime) / 1000;
        metrics.observeHistogram(METRICS.REGISTRY_REQUEST_DURATION, duration, {
          registry: imageRef.registry,
          status: "404",
        });
        return false;
      }

      // Other errors
      throw new Error(`Skopeo inspect failed: ${stderr.trim()}`);
    } catch (error) {
      if (error instanceof Error && error.message === "timeout") {
        throw new Error(`Request to ${imageRef.registry} timed out after ${this.timeout}ms`);
      }
      throw error;
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
   * Clear the token cache (no-op for Skopeo, kept for API compatibility)
   */
  clearTokenCache(): void {
    // Skopeo handles authentication internally, no cache to clear
  }

  /**
   * Test connectivity to a registry using skopeo
   */
  async testRegistryConnectivity(registry: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    logger.debug("Testing connectivity to registry", { registry });
    
    try {
      // Try to list tags for a common repository
      // This is a lightweight operation that tests connectivity
      const testImage = `${registry}/library/busybox:latest`;
      const args = ["inspect", `docker://${testImage}`];

      // Add credentials if available
      const creds = getCredentialsForRegistry(this.authConfig, registry);
      if (creds) {
        args.push("--creds", `${creds.username}:${creds.password}`);
      }

      // Add insecure flag if registry is in the insecure list
      if (this.insecureRegistries.includes(registry)) {
        args.push("--tls-verify=false");
      }

      const proc = Bun.spawn(["skopeo", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });

      // Short timeout for connectivity test
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), 10000);
      });

      const result = await Promise.race([proc.exited, timeoutPromise]);

      // Any successful response means we can connect (even if the image doesn't exist)
      // 0 = success, non-zero but not a connection error = also ok for connectivity test
      if (result === 0) {
        logger.debug("Successfully connected to registry", { registry });
        return { success: true };
      }

      const stderr = await new Response(proc.stderr).text();
      
      // These errors mean we connected but image doesn't exist - that's ok for connectivity test
      if (stderr.includes("manifest unknown") || stderr.includes("not found")) {
        return { success: true };
      }
      
      // Connection errors
      if (stderr.includes("connection refused") || 
          stderr.includes("no such host") ||
          stderr.includes("timeout") ||
          stderr.includes("network unreachable")) {
        return { 
          success: false, 
          error: `Connection error: ${stderr.trim()}` 
        };
      }

      logger.warn("Registry returned unexpected error", { registry, error: stderr });
      return { 
        success: false, 
        error: stderr.trim() 
      };
    } catch (error) {
      let errorMessage: string;
      
      if (error instanceof Error && error.message === "timeout") {
        errorMessage = `Connection timeout after 10s`;
      } else {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      
      logger.error("Failed to connect to registry", undefined, { registry, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Clone an image from source to target registry using skopeo copy
   */
  async cloneImage(sourceImage: string, targetRegistry: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const startTime = Date.now();
    const sourceRef = parseImageReference(sourceImage);
    logger.debug("Starting image clone", { sourceImage, targetRegistry, sourceRegistry: sourceRef.registry, sourceRepository: sourceRef.repository });
    
    // Build target image reference
    const targetImage = sourceRef.digest
      ? `${targetRegistry}/${sourceRef.repository}@${sourceRef.digest}`
      : `${targetRegistry}/${sourceRef.repository}:${sourceRef.tag || "latest"}`;
    const targetRef = parseImageReference(targetImage);
    logger.debug("Target image prepared", { targetImage, targetRegistry: targetRef.registry, targetRepository: targetRef.repository });

    logger.info(`Cloning image from source to target`, { sourceImage, targetImage });

    try {
      // Use skopeo copy for efficient registry-to-registry transfer
      // Skopeo will handle connectivity and authentication errors directly
      const args = ["copy", `docker://${sourceImage}`, `docker://${targetImage}`];

      // Add source credentials
      const sourceCreds = getCredentialsForRegistry(this.authConfig, sourceRef.registry);
      if (sourceCreds) {
        args.push("--src-creds", `${sourceCreds.username}:${sourceCreds.password}`);
      }

      // Add destination credentials
      const targetCreds = getCredentialsForRegistry(this.authConfig, targetRef.registry);
      if (targetCreds) {
        args.push("--dest-creds", `${targetCreds.username}:${targetCreds.password}`);
      }

      // Add insecure flags if needed
      if (this.insecureRegistries.includes(sourceRef.registry)) {
        args.push("--src-tls-verify=false");
      }
      if (this.insecureRegistries.includes(targetRef.registry)) {
        args.push("--dest-tls-verify=false");
      }

      // Add --all flag to copy all architectures in manifest lists
      args.push("--all");

      logger.debug("Executing skopeo copy", { args: sanitizeArgs(args) });

      const proc = Bun.spawn(["skopeo", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });

      // Wait for process to complete with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), this.timeout);
      });

      const result = await Promise.race([proc.exited, timeoutPromise]);

      if (result !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`Skopeo copy failed: ${stderr.trim()}`);
      }

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

      logger.info("Successfully cloned image", { sourceImage, targetImage, duration });
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

      logger.error("Failed to clone image", error, { sourceImage, targetImage, duration });
      return { success: false, error: errorMessage };
    }
  }
}
