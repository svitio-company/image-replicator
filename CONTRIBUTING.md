# Contributing to Image Replicator

Thank you for your interest in contributing! 🎉

## Getting Started

### Prerequisites
- Bun 1.3+
- Kubernetes cluster (for testing)
- Docker

### Development Setup

```bash
# Clone the repository
git clone https://github.com/svitio-company/image-replicator.git
cd image-replicator

# Install dependencies
bun install

# Run tests
bun test

# Run in development mode
bun run dev
```

## How to Contribute

### Reporting Bugs

Before creating a bug report, please check existing issues. When creating a bug report, include:

- **Clear title and description**
- **Steps to reproduce**
- **Expected vs actual behavior**
- **Environment details** (Kubernetes version, registry type)
- **Logs** (if applicable)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- **Use a clear title**
- **Provide detailed description**
- **Explain why this would be useful**
- **Include examples** (if applicable)

### Pull Requests

1. **Fork the repo** and create your branch from `main`
2. **Follow semantic commit messages:**
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation
   - `test:` Tests
   - `chore:` Maintenance
3. **Add tests** for your changes
4. **Update documentation** if needed
5. **Ensure all tests pass:** `bun test`
6. **Type-check passes:** `bun run type-check`
7. **Create a PR** with clear description

### Code Style

- Use TypeScript strict mode
- Follow existing code patterns
- Add JSDoc comments for public APIs
- Keep functions small and focused

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add support for Harbor registry
fix: resolve authentication timeout issue
docs: update helm chart installation guide
test: add integration tests for image cloning
chore: update dependencies
```

### Testing

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run benchmarks
bun run benchmark

# Type check
bun run type-check
```

## Development Workflow

1. Create an issue first (for significant changes)
2. Fork and create a feature branch
3. Make your changes
4. Add tests
5. Run tests and type-check
6. Submit PR referencing the issue
7. Address review feedback

## Project Structure

```
├── src/
│   ├── handlers/        # Admission webhook handlers
│   ├── services/        # Core services (registry client, metrics)
│   ├── utils/           # Utilities (image parser, credentials)
│   └── types/           # TypeScript type definitions
├── chart/               # Helm chart
├── .github/workflows/   # CI/CD pipelines
└── benchmark.ts         # Performance benchmarks
```

## Release Process

Releases are automated:
1. Maintainers merge PRs to `main`
2. Create a git tag: `git tag v1.0.0`
3. Push tag: `git push origin v1.0.0`
4. GitHub Actions builds Docker image and Helm chart
5. Release published automatically

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.

## Questions?

Feel free to open a discussion or reach out to maintainers!
