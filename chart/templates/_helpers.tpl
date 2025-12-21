{{/*
Expand the name of the chart.
*/}}
{{- define "image-replicator.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "image-replicator.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "image-replicator.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "image-replicator.labels" -}}
helm.sh/chart: {{ include "image-replicator.chart" . }}
{{ include "image-replicator.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "image-replicator.selectorLabels" -}}
app.kubernetes.io/name: {{ include "image-replicator.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "image-replicator.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "image-replicator.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create the name of the TLS secret
*/}}
{{- define "image-replicator.tlsSecretName" -}}
{{- if .Values.tls.existingSecret }}
{{- .Values.tls.existingSecret }}
{{- else if .Values.certManager.enabled }}
{{- include "image-replicator.fullname" . }}-tls
{{- else }}
{{- include "image-replicator.fullname" . }}-tls
{{- end }}
{{- end }}

{{/*
Create the name of the registry credentials secret
*/}}
{{- define "image-replicator.credentialsSecretName" -}}
{{- if .Values.registryCredentials.existingSecret }}
{{- .Values.registryCredentials.existingSecret }}
{{- else }}
{{- include "image-replicator.fullname" . }}-credentials
{{- end }}
{{- end }}

{{/*
Get the webhook service name
*/}}
{{- define "image-replicator.webhookServiceName" -}}
{{- include "image-replicator.fullname" . }}
{{- end }}

{{/*
Get the webhook service FQDN
*/}}
{{- define "image-replicator.webhookServiceFqdn" -}}
{{- printf "%s.%s.svc" (include "image-replicator.webhookServiceName" .) .Release.Namespace }}
{{- end }}

{{/*
Get cert-manager issuer name
*/}}
{{- define "image-replicator.issuerName" -}}
{{- if .Values.certManager.issuer.name }}
{{- .Values.certManager.issuer.name }}
{{- else }}
{{- include "image-replicator.fullname" . }}-issuer
{{- end }}
{{- end }}
