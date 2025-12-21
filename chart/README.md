# Image Replicator Helm Chart

This Helm chart deploys the Image Replicator to a Kubernetes cluster.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.0+
- cert-manager (optional but recommended)

## Installing the Chart

### Install cert-manager (recommended)

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

### Install the webhook

```bash
# Add your registry credentials
cat > my-values.yaml <<EOF
registryCredentials:
  enabled: true
  registries:
    - name: DOCKERHUB
      url: docker.io
      username: your-username
      password: your-password
EOF

# Install the chart
helm install image-replicator ./chart -f my-values.yaml -n image-replicator --create-namespace
```

## Configuration

See [values.yaml](values.yaml) for all configuration options.

### Key Configuration Options

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas | `2` |
| `image.repository` | Image repository | `image-replicator` |
| `image.tag` | Image tag | `latest` |
| `certManager.enabled` | Use cert-manager for certificates | `true` |
| `registryCredentials.enabled` | Enable registry credentials | `false` |
| `webhook.failurePolicy` | Webhook failure policy | `Ignore` |

### Registry Credentials

#### Option 1: Individual Registries

```yaml
registryCredentials:
  enabled: true
  registries:
    - name: DOCKERHUB
      url: docker.io
      username: your-username
      password: your-password
    - name: GHCR
      url: ghcr.io
      username: your-github-user
      token: ghp_xxxxx
```

#### Option 2: Docker Config JSON

```yaml
registryCredentials:
  enabled: true
  dockerConfigJson: |
    {
      "auths": {
        "docker.io": {
          "username": "user",
          "password": "pass"
        }
      }
    }
```

#### Option 3: Use Existing Secret

```yaml
registryCredentials:
  existingSecret: my-registry-secret
```

### cert-manager Configuration

```yaml
certManager:
  enabled: true
  issuer:
    create: true
    kind: ClusterIssuer
  certificate:
    duration: 8760h
    renewBefore: 720h
```

### Without cert-manager

```yaml
certManager:
  enabled: false

tls:
  crt: |
    -----BEGIN CERTIFICATE-----
    ...
    -----END CERTIFICATE-----
  key: |
    -----BEGIN PRIVATE KEY-----
    ...
    -----END PRIVATE KEY-----
  ca: |
    -----BEGIN CERTIFICATE-----
    ...
    -----END CERTIFICATE-----
```

## Upgrading

```bash
helm upgrade image-replicator ./chart -f my-values.yaml -n image-replicator
```

## Uninstalling

```bash
helm uninstall image-replicator -n image-replicator
```

## Examples

See [values-example.yaml](values-example.yaml) for a complete production configuration example.

## Testing

```bash
# Test with invalid image (should be denied)
kubectl run test-invalid --image=this-image-does-not-exist:v999

# Test with valid image (should be allowed)
kubectl run test-valid --image=nginx:latest

# Skip validation with label
kubectl run test-skip --image=any-image --labels="image-replicator.io/skip=true"
```

## Troubleshooting

### View webhook logs

```bash
kubectl logs -l app.kubernetes.io/name=image-replicator -n image-replicator -f
```

### Check webhook configuration

```bash
kubectl get validatingwebhookconfiguration image-replicator -o yaml
```

### Check certificate

```bash
kubectl get certificate -n image-replicator
kubectl describe certificate image-replicator -n image-replicator
```

### Test webhook directly

```bash
kubectl run test-pod --image=nginx:latest --dry-run=server -o yaml
```
