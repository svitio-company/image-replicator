---
name: Bug report
about: Create a report to help us improve
title: '[BUG] '
labels: bug
assignees: ''
---

## Describe the bug
A clear and concise description of what the bug is.

## To Reproduce
Steps to reproduce the behavior:
1. Deploy with configuration '...'
2. Create pod with image '...'
3. See error

## Expected behavior
A clear and concise description of what you expected to happen.

## Environment
- **Kubernetes version:** [e.g. 1.28.0]
- **Image Replicator version:** [e.g. 1.0.0]
- **Registry type:** [e.g. ACR, Docker Hub, GCR]
- **Deployment method:** [e.g. Helm, kubectl]
- **Cloud provider:** [e.g. AKS, EKS, GKE, self-hosted]

## Configuration
```yaml
# Paste relevant configuration (values.yaml, env vars, etc.)
# Remember to redact sensitive information!
```

## Logs
```
Paste relevant logs here from:
kubectl logs -l app.kubernetes.io/name=image-replicator -n image-replicator

Or webhook logs showing the issue
```

## Additional context
Add any other context about the problem here:
- Does it happen consistently or intermittently?
- Any recent changes to the cluster or configuration?
- Any error messages in Kubernetes events?

## Screenshots
If applicable, add screenshots to help explain your problem.
