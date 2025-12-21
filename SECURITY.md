# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: **martin.slanina@svitio.cz**

### What to Include

Please include the following information in your report:

- **Type of vulnerability** (e.g., authentication bypass, code injection, etc.)
- **Full paths of source file(s)** related to the vulnerability
- **Location of the affected source code** (tag/branch/commit or direct URL)
- **Step-by-step instructions to reproduce** the issue
- **Proof-of-concept or exploit code** (if possible)
- **Impact of the issue** - how an attacker might exploit it
- **Any special configuration required** to reproduce the issue

### Response Timeline

- We'll acknowledge receipt within **48 hours**
- We'll provide a detailed response within **7 days** indicating next steps
- We'll keep you informed about our progress toward a fix and full announcement
- We may ask for additional information or guidance

## Disclosure Policy

When we receive a security bug report, we will:

1. **Confirm the problem** and determine affected versions
2. **Audit code** to find any similar problems
3. **Prepare fixes** for all supported releases
4. **Release patches** as soon as possible
5. **Publish security advisory** on GitHub

### Security Advisory

Once a fix is released, we will:

- Publish a GitHub Security Advisory
- Credit the reporter (unless they prefer to remain anonymous)
- Notify users via release notes
- Update documentation with mitigation steps if needed

## Security Best Practices

When deploying Image Replicator:

### TLS Configuration
- ✅ Use cert-manager for automatic TLS certificate management
- ✅ Ensure webhook uses TLS 1.2 or higher
- ✅ Rotate certificates regularly

### Credentials Management
- ✅ Store registry credentials in Kubernetes Secrets
- ✅ Use encrypted Secrets at rest (if available)
- ✅ Limit Secret access with RBAC
- ✅ Rotate credentials regularly

### Network Security
- ✅ Use NetworkPolicies to restrict webhook access
- ✅ Only allow traffic from Kubernetes API server
- ✅ Deploy in a dedicated namespace

### RBAC
- ✅ Use least-privilege service accounts
- ✅ Don't grant cluster-admin permissions
- ✅ Review and audit RBAC policies regularly

### Image Security
- ✅ Use specific version tags, not `latest`
- ✅ Verify image provenance before deployment:
  ```bash
  gh attestation verify oci://ghcr.io/svitio-company/image-replicator:1.0.0 \
    --owner svitio-company
  ```
- ✅ Scan images for vulnerabilities regularly
- ✅ Keep the image up-to-date with latest security patches

### Monitoring & Auditing
- ✅ Enable audit logging in Kubernetes
- ✅ Monitor webhook metrics for anomalies
- ✅ Set up alerts for failed validations
- ✅ Review logs regularly for suspicious activity

### Target Registry Security
- ✅ Use dedicated service accounts with minimal permissions
- ✅ Enable audit logging on target registry
- ✅ Monitor for unexpected image pushes
- ✅ Implement image signing/verification

## Known Security Considerations

### Image Cloning
The webhook clones images from source to target registries. Be aware:

- **Malicious images**: If source registry is compromised, malicious images could be cloned
- **Mitigation**: Use trusted source registries and implement image scanning

### Authentication Tokens
The webhook caches authentication tokens for performance:

- **Risk**: Tokens are stored in memory
- **Mitigation**: Tokens expire based on registry configuration, use short-lived tokens when possible

### Admission Control
The webhook can block pod creation:

- **Risk**: Misconfiguration could cause denial of service
- **Mitigation**: Test thoroughly, use fail-open mode in non-production environments

## Security Updates

Subscribe to security advisories:
- Watch this repository for security updates
- Subscribe to [GitHub Security Advisories](https://github.com/svitio-company/image-replicator/security/advisories)
- Follow release notes for security fixes

## Compliance

This project follows security best practices from:
- CNCF Security Best Practices
- Kubernetes Security Guidelines
- SLSA Framework (Level 3)
- OWASP Secure Coding Practices

## Questions?

For security-related questions that are not vulnerabilities, open a GitHub discussion or contact maintainers.
