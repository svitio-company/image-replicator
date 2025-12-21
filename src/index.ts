import type { AdmissionReviewRequest } from "./types";
import { RegistryClient } from "./services/registry-client";
import { handleAdmissionReview } from "./handlers/admission";
import { loadCredentials } from "./utils/credentials";
import { metrics } from "./services/metrics";

// Configuration from environment
const PORT = parseInt(Bun.env.PORT || "8443", 10);
const TLS_CERT_PATH = Bun.env.TLS_CERT_PATH || "/certs/tls.crt";
const TLS_KEY_PATH = Bun.env.TLS_KEY_PATH || "/certs/tls.key";
const SKIP_TLS = Bun.env.SKIP_TLS === "true";
const HEALTH_PORT = parseInt(Bun.env.HEALTH_PORT || "8080", 10);
const TARGET_REGISTRY = Bun.env.TARGET_REGISTRY; // e.g., "myregistry.azurecr.io"
const REGISTRY_TIMEOUT = parseInt(Bun.env.REGISTRY_TIMEOUT || "240000", 10); // 4 minutes default

console.log("Starting Image Validator Webhook...");
console.log(`Configuration:
  - Webhook Port: ${PORT}
  - Health Port: ${HEALTH_PORT}
  - TLS Enabled: ${!SKIP_TLS}
  - TLS Cert: ${TLS_CERT_PATH}
  - TLS Key: ${TLS_KEY_PATH}
  - Target Registry: ${TARGET_REGISTRY || "(not set - checking source registries)"}
  - Registry Timeout: ${REGISTRY_TIMEOUT}ms
`);

// Load registry credentials
const authConfig = await loadCredentials();
console.log(
  `Loaded credentials for ${authConfig.credentials.size} registries`
);
if (authConfig.defaultCredentials) {
  console.log(
    `Default credentials configured for: ${authConfig.defaultCredentials.registry}`
  );
}

// Create registry client
const registryClient = new RegistryClient(authConfig, TARGET_REGISTRY, REGISTRY_TIMEOUT);

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

console.log(`Health server listening on port ${HEALTH_PORT}`);

// TLS configuration
let tlsConfig: { cert: string; key: string } | undefined;

if (!SKIP_TLS) {
  try {
    const certFile = Bun.file(TLS_CERT_PATH);
    const keyFile = Bun.file(TLS_KEY_PATH);

    if (!(await certFile.exists()) || !(await keyFile.exists())) {
      console.error(
        `TLS certificate or key not found at ${TLS_CERT_PATH} and ${TLS_KEY_PATH}`
      );
      console.error("Set SKIP_TLS=true for development or provide valid certificates");
      process.exit(1);
    }

    tlsConfig = {
      cert: await certFile.text(),
      key: await keyFile.text(),
    };
    console.log("TLS certificates loaded successfully");
  } catch (error) {
    console.error("Failed to load TLS certificates:", error);
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
        console.error("Error processing admission review:", error);
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

console.log(
  `Webhook server listening on port ${PORT} (TLS: ${!SKIP_TLS})`
);

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  healthServer.stop();
  webhookServer.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully...");
  healthServer.stop();
  webhookServer.stop();
  process.exit(0);
});

export { webhookServer, healthServer };
