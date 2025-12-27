# Use Bun as base image
FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Build the application
RUN bun build src/index.ts --outdir dist --target bun

# Production image - distroless (minimal, no shell, non-root by default)
FROM oven/bun:1.3-distroless

WORKDIR /app

# Copy only the built application (single file bundle)
COPY --from=builder /app/dist/index.js .

# Expose ports
EXPOSE 8443 8080

# Run the application
# Distroless runs as non-root user (bun) by default
ENTRYPOINT [ "bun", "run", "index.js" ]
