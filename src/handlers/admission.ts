import type {
  AdmissionReviewRequest,
  AdmissionReviewResponse,
  Container,
  PodSpec,
  PodTemplateSpec,
  JobSpec,
  CronJobSpec,
  DeploymentSpec,
  StatefulSetSpec,
  DaemonSetSpec,
  ReplicaSetSpec,
  ImageValidationResult,
} from "../types";
import { RegistryClient } from "../services/registry-client";
import { metrics, METRICS } from "../services/metrics";
import { logger } from "../utils/logger";

/**
 * Extract all container images from a Kubernetes object
 */
export function extractImagesFromObject(
  kind: string,
  spec: unknown
): string[] {
  const images: string[] = [];

  switch (kind) {
    case "Pod":
      extractImagesFromPodSpec(spec as PodSpec, images);
      break;
    case "Job":
      extractImagesFromJobSpec(spec as JobSpec, images);
      break;
    case "CronJob":
      extractImagesFromCronJobSpec(spec as CronJobSpec, images);
      break;
    case "Deployment":
    case "ReplicaSet":
      extractImagesFromDeploymentSpec(spec as DeploymentSpec | ReplicaSetSpec, images);
      break;
    case "StatefulSet":
      extractImagesFromStatefulSetSpec(spec as StatefulSetSpec, images);
      break;
    case "DaemonSet":
      extractImagesFromDaemonSetSpec(spec as DaemonSetSpec, images);
      break;
    default:
      // Try to extract from common patterns
      if (spec && typeof spec === "object") {
        tryExtractFromUnknownSpec(spec as Record<string, unknown>, images);
      }
  }

  return [...new Set(images)]; // Return unique images
}

function extractImagesFromPodSpec(spec: PodSpec, images: string[]): void {
  if (!spec) return;

  // Regular containers
  if (spec.containers) {
    spec.containers.forEach((c: Container) => {
      if (c.image) images.push(c.image);
    });
  }

  // Init containers
  if (spec.initContainers) {
    spec.initContainers.forEach((c: Container) => {
      if (c.image) images.push(c.image);
    });
  }

  // Ephemeral containers
  if (spec.ephemeralContainers) {
    spec.ephemeralContainers.forEach((c: Container) => {
      if (c.image) images.push(c.image);
    });
  }
}

function extractImagesFromPodTemplateSpec(
  template: PodTemplateSpec,
  images: string[]
): void {
  if (template?.spec) {
    extractImagesFromPodSpec(template.spec, images);
  }
}

function extractImagesFromJobSpec(spec: JobSpec, images: string[]): void {
  if (spec?.template) {
    extractImagesFromPodTemplateSpec(spec.template, images);
  }
}

function extractImagesFromCronJobSpec(spec: CronJobSpec, images: string[]): void {
  if (spec?.jobTemplate?.spec) {
    extractImagesFromJobSpec(spec.jobTemplate.spec, images);
  }
}

function extractImagesFromDeploymentSpec(
  spec: DeploymentSpec | ReplicaSetSpec,
  images: string[]
): void {
  if (spec?.template) {
    extractImagesFromPodTemplateSpec(spec.template, images);
  }
}

function extractImagesFromStatefulSetSpec(
  spec: StatefulSetSpec,
  images: string[]
): void {
  if (spec?.template) {
    extractImagesFromPodTemplateSpec(spec.template, images);
  }
}

function extractImagesFromDaemonSetSpec(
  spec: DaemonSetSpec,
  images: string[]
): void {
  if (spec?.template) {
    extractImagesFromPodTemplateSpec(spec.template, images);
  }
}

function tryExtractFromUnknownSpec(
  spec: Record<string, unknown>,
  images: string[]
): void {
  // Try to find template.spec.containers pattern
  if (spec.template && typeof spec.template === "object") {
    const template = spec.template as Record<string, unknown>;
    if (template.spec && typeof template.spec === "object") {
      extractImagesFromPodSpec(template.spec as PodSpec, images);
    }
  }
  // Try direct containers
  if (spec.containers && Array.isArray(spec.containers)) {
    (spec.containers as Container[]).forEach((c) => {
      if (c.image) images.push(c.image);
    });
  }
}

/**
 * Handle admission review request
 */
export async function handleAdmissionReview(
  request: AdmissionReviewRequest,
  registryClient: RegistryClient
): Promise<AdmissionReviewResponse> {
  const startTime = Date.now();
  const { uid, kind, object, operation, namespace } = request.request;
  const subResource = (request.request as any).subResource;

  // Track in-flight requests
  metrics.incrementGauge(METRICS.REQUESTS_IN_FLIGHT);

  try {
    logger.info(
      `Processing ${operation} request for ${kind.kind}/${object?.metadata?.name || "unknown"} in namespace ${namespace || "default"}${subResource ? ` (subResource: ${subResource})` : ""}`,
      { uid, operation, kind: kind.kind, namespace: namespace || "default" }
    );

    // Skip validation for subresources (scale, status, etc.) - they don't change images
    if (subResource) {
      logger.info(`Skipping validation for subresource: ${subResource}`, { uid });
      metrics.incrementCounter(METRICS.ADMISSION_REQUESTS_TOTAL, {
        operation,
        kind: kind.kind,
        result: "skipped",
        reason: "subresource",
      });
      return createAllowedResponse(uid);
    }

    // Only validate CREATE and UPDATE operations
    if (operation !== "CREATE" && operation !== "UPDATE") {
      logger.info(`Skipping validation for ${operation} operation`, { uid, operation });
      metrics.incrementCounter(METRICS.ADMISSION_REQUESTS_TOTAL, {
        operation,
        kind: kind.kind,
        result: "skipped",
        reason: "operation",
      });
      return createAllowedResponse(uid);
    }

    // Extract images from the object (use optional chaining for safety)
    const images = extractImagesFromObject(kind.kind, object?.spec);

    if (images.length === 0) {
      logger.info("No images found in object, allowing", { uid });
      metrics.incrementCounter(METRICS.ADMISSION_REQUESTS_TOTAL, {
        operation,
        kind: kind.kind,
        result: "allowed",
        reason: "no_images",
      });
      return createAllowedResponse(uid);
    }

    logger.info(`Found ${images.length} images to validate`, { uid, imageCount: images.length, images: images.join(", ") });

    // Check all images
    const results = await registryClient.checkImages(images);

    // Track image validation results
    results.forEach((result) => {
      const status = result.exists ? "exists" : result.error ? "error" : "not_found";
      metrics.incrementCounter(METRICS.IMAGE_VALIDATION_TOTAL, {
        registry: result.registry,
        status,
      });
    });

    // Find any images that don't exist
    const missingImages = results.filter((r) => !r.exists);
    const targetRegistry = registryClient.getTargetRegistry();

    if (missingImages.length > 0 && targetRegistry) {
      logger.info(`Found ${missingImages.length} images missing from target registry, attempting to clone`, { uid, missingCount: missingImages.length });
      
      // Clone missing images
      const cloneResults = await Promise.all(
        missingImages.map(async (missing) => {
          const result = await registryClient.cloneImage(missing.image, targetRegistry);
          return { image: missing.image, ...result };
        })
      );

      // Check if all clones succeeded
      const failedClones = cloneResults.filter((r) => !r.success);
      
      if (failedClones.length > 0) {
        const errorMessage = `Failed to clone ${failedClones.length} image(s):\n` +
          failedClones.map((r) => `  - ${r.image}: ${r.error}`).join("\n");
        logger.error("Clone failed", errorMessage, { uid, failedCount: failedClones.length });
        metrics.incrementCounter(METRICS.ADMISSION_REQUESTS_TOTAL, {
          operation,
          kind: kind.kind,
          result: "denied",
          reason: "clone_failed",
        });
        return createDeniedResponse(uid, errorMessage);
      }

      logger.info("Successfully cloned all images", { uid, clonedCount: cloneResults.length });
    } else if (missingImages.length > 0) {
      // No target registry configured - deny
      const errorMessage = formatValidationError(missingImages);
      logger.error("Validation failed", errorMessage, { uid, missingCount: missingImages.length });
      metrics.incrementCounter(METRICS.ADMISSION_REQUESTS_TOTAL, {
        operation,
        kind: kind.kind,
        result: "denied",
        reason: "images_not_found",
      });
      return createDeniedResponse(uid, errorMessage);
    }

    // All images exist
    logger.info("All images validated successfully", { uid });
    metrics.incrementCounter(METRICS.ADMISSION_REQUESTS_TOTAL, {
      operation,
      kind: kind.kind,
      result: "allowed",
      reason: "validated",
    });
    return createAllowedResponse(uid, formatValidationWarnings(results));
  } finally {
    // Record request duration
    const duration = (Date.now() - startTime) / 1000;
    metrics.observeHistogram(METRICS.ADMISSION_REQUEST_DURATION, duration, {
      operation,
      kind: kind.kind,
    });
    
    // Decrement in-flight requests
    metrics.decrementGauge(METRICS.REQUESTS_IN_FLIGHT);
  }
}

/**
 * Create an allowed admission response
 */
function createAllowedResponse(
  uid: string,
  warnings?: string[]
): AdmissionReviewResponse {
  return {
    apiVersion: "admission.k8s.io/v1",
    kind: "AdmissionReview",
    response: {
      uid,
      allowed: true,
      warnings,
    },
  };
}

/**
 * Create a denied admission response
 */
function createDeniedResponse(
  uid: string,
  message: string
): AdmissionReviewResponse {
  return {
    apiVersion: "admission.k8s.io/v1",
    kind: "AdmissionReview",
    response: {
      uid,
      allowed: false,
      status: {
        code: 403,
        message,
      },
    },
  };
}

/**
 * Format validation error message
 */
function formatValidationError(missingImages: ImageValidationResult[]): string {
  const details = missingImages
    .map((r) => {
      const errorInfo = r.error ? ` (${r.error})` : "";
      return `  - ${r.image} in ${r.registry}${errorInfo}`;
    })
    .join("\n");

  return `Image validation failed. The following images do not exist or are not accessible:\n${details}`;
}

/**
 * Format validation warnings
 */
function formatValidationWarnings(
  results: ImageValidationResult[]
): string[] | undefined {
  const warnings: string[] = [];

  // Add warnings for images that had issues but eventually succeeded
  results.forEach((r) => {
    if (r.exists && r.error) {
      warnings.push(
        `Image ${r.image} exists but had validation issues: ${r.error}`
      );
    }
  });

  return warnings.length > 0 ? warnings : undefined;
}
