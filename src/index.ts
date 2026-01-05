import type { AdmissionReviewRequest } from "./types";
import { RegistryClient } from "./services/registry-client";
import { handleAdmissionReview } from "./handlers/admission";
import { loadCredentials } from "./utils/credentials";
import { metrics } from "./services/metrics";
import { logger, initLogger } from "./utils/logger";

// Configuration from environment
const PORT = parseInt(Bun.env.PORT || "8443", 10);
const TLS_CERT_PATH = Bun.env.TLS_CERT_PATH || "/certs/tls.crt";
const TLS_KEY_PATH = Bun.env.TLS_KEY_PATH || "/certs/tls.key";
const SKIP_TLS = Bun.env.SKIP_TLS === "true";
const HEALTH_PORT = parseInt(Bun.env.HEALTH_PORT || "8080", 10);
const TARGET_REGISTRY = Bun.env.TARGET_REGISTRY; // e.g., "myregistry.azurecr.io"
const REGISTRY_TIMEOUT = parseInt(Bun.env.REGISTRY_TIMEOUT || "240000", 10); // 4 minutes default
const INSECURE_REGISTRIES = Bun.env.INSECURE_REGISTRIES?.split(",").map(r => r.trim()).filter(Boolean) || [];
const DEBUG = Bun.env.DEBUG === "true";

// Initialize logger with DEBUG flag
initLogger(DEBUG);

logger.info("Starting Image Validator Webhook...");
logger.info(`Configuration:
  - Webhook Port: ${PORT}
  - Health Port: ${HEALTH_PORT}
  - TLS Enabled: ${!SKIP_TLS}
  - TLS Cert: ${TLS_CERT_PATH}
  - TLS Key: ${TLS_KEY_PATH}
  - Target Registry: ${TARGET_REGISTRY || "(not set - checking source registries)"}
  - Registry Timeout: ${REGISTRY_TIMEOUT}ms
  - Insecure Registries: ${INSECURE_REGISTRIES.length > 0 ? INSECURE_REGISTRIES.join(", ") : "(none)"}
  - Debug Logging: ${DEBUG}
`);

// Load registry credentials
const authConfig = await loadCredentials();
logger.info("Loaded credentials", { registryCount: authConfig.credentials.size });
if (authConfig.defaultCredentials) {
  logger.info("Default credentials configured", { registry: authConfig.defaultCredentials.registry });
}

// Validate credentials configuration
if (authConfig.credentials.size > 0 || authConfig.defaultCredentials) {
  logger.info("Registry credentials configured");
  for (const [registry] of authConfig.credentials) {
    logger.info(`  - ${registry}`);
  }
  if (authConfig.defaultCredentials) {
    logger.info(`  - Default: ${authConfig.defaultCredentials.registry}`);
  }
} else {
  logger.warn("No registry credentials configured");
  logger.warn("  - Private source registries (Docker Hub, GHCR, etc.) will fail");
  logger.warn("  - Only public registries will be accessible");
}

// Validate TARGET_REGISTRY credentials if replication is enabled
if (TARGET_REGISTRY) {
  const normalizedTarget = TARGET_REGISTRY.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const hasTargetCreds = authConfig.credentials.has(normalizedTarget) || 
                         authConfig.defaultCredentials?.registry === normalizedTarget;
  
  if (!hasTargetCreds) {
    logger.warn("WARNING: Image replication enabled but no credentials for target registry!");
    logger.warn(`  - Target registry: ${TARGET_REGISTRY}`);
    logger.warn("  - Replication will fail without authentication");
    logger.warn(`  - Add credentials for "${normalizedTarget}" to registry-credentials secret`);
    
    // Optionally make it fatal
    if (Bun.env.REQUIRE_CREDENTIALS === "true") {
      logger.error("REQUIRE_CREDENTIALS=true: Exiting due to missing target registry credentials");
      process.exit(1);
    }
  } else {
    logger.info("Target registry credentials verified", { targetRegistry: TARGET_REGISTRY });
  }
}

// Create registry client
const registryClient = new RegistryClient(authConfig, TARGET_REGISTRY, REGISTRY_TIMEOUT, INSECURE_REGISTRIES);

// Health check server (HTTP)
const healthServer = Bun.serve({
  port: HEALTH_PORT,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/healthz" || url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/readyz" || url.pathname === "/ready") {
      return new Response(JSON.stringify({ status: "ready" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/metrics") {
      return new Response(metrics.generatePrometheusMetrics(), {
        headers: { "Content-Type": "text/plain; version=0.0.4" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

logger.info("Health server listening", { port: HEALTH_PORT });

// TLS configuration
let tlsConfig: { cert: string; key: string } | undefined;

if (!SKIP_TLS) {
  try {
    const certFile = Bun.file(TLS_CERT_PATH);
    const keyFile = Bun.file(TLS_KEY_PATH);

    if (!(await certFile.exists()) || !(await keyFile.exists())) {
      logger.error("TLS certificate or key not found", undefined, { certPath: TLS_CERT_PATH, keyPath: TLS_KEY_PATH });
      logger.error("Set SKIP_TLS=true for development or provide valid certificates");
      process.exit(1);
    }

    tlsConfig = {
      cert: await certFile.text(),
      key: await keyFile.text(),
    };
    logger.info("TLS certificates loaded successfully");
  } catch (error) {
    logger.error("Failed to load TLS certificates", error);
    process.exit(1);
  }
}

// Main webhook server
const webhookServer = Bun.serve({
  port: PORT,
  tls: tlsConfig,
  async fetch(req) {
    const url = new URL(req.url);

    // Handle admission webhook
    if (url.pathname === "/validate" && req.method === "POST") {
      try {
        const contentType = req.headers.get("Content-Type");
        if (!contentType?.includes("application/json")) {
          return new Response("Content-Type must be application/json", {
            status: 415,
          });
        }

        const admissionReview = (await req.json()) as AdmissionReviewRequest;

        // Validate request structure
        if (!admissionReview.request?.uid) {
          return new Response("Invalid AdmissionReview: missing request.uid", {
            status: 400,
          });
        }

        const response = await handleAdmissionReview(
          admissionReview,
          registryClient
        );

        return new Response(JSON.stringify(response), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        logger.error("Error processing admission review", error);
        return new Response(
          JSON.stringify({
            apiVersion: "admission.k8s.io/v1",
            kind: "AdmissionReview",
            response: {
              uid: "",
              allowed: true, // Allow on error to not block deployments
              warnings: [
                `Webhook error: ${error instanceof Error ? error.message : String(error)}`,
              ],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    // Health endpoints on webhook port too
    if (url.pathname === "/healthz" || url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/metrics") {
      return new Response(metrics.generatePrometheusMetrics(), {
        headers: { "Content-Type": "text/plain; version=0.0.4" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

logger.info("Webhook server listening", { port: PORT, tls: !SKIP_TLS });

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  healthServer.stop();
  webhookServer.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  healthServer.stop();
  webhookServer.stop();
  process.exit(0);
});

export { webhookServer, healthServer };
