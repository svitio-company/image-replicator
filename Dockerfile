# Use Bun as base image for building
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

# Production image - Alpine with Bun and Skopeo
FROM oven/bun:1.3-alpine

WORKDIR /app

# Install skopeo from Alpine repositories
RUN apk add --no-cache skopeo

# Copy only the built application (single file bundle)
COPY --from=builder /app/dist/index.js .

# Create non-root user
RUN addgroup -g 1001 -S appuser && \
    adduser -u 1001 -S appuser -G appuser

# Change ownership of the app directory
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose ports
EXPOSE 8443 8080

# Run the application
ENTRYPOINT [ "bun", "run", "index.js" ]
