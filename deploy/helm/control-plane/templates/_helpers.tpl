{{/*
Expand the name of the chart.
*/}}
{{- define "control-plane.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "control-plane.fullname" -}}
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
{{- define "control-plane.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "control-plane.labels" -}}
helm.sh/chart: {{ include "control-plane.chart" . }}
{{ include "control-plane.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "control-plane.selectorLabels" -}}
app.kubernetes.io/name: {{ include "control-plane.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
API labels
*/}}
{{- define "control-plane.api.labels" -}}
{{ include "control-plane.labels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
API selector labels
*/}}
{{- define "control-plane.api.selectorLabels" -}}
{{ include "control-plane.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
Web labels
*/}}
{{- define "control-plane.web.labels" -}}
{{ include "control-plane.labels" . }}
app.kubernetes.io/component: web
{{- end }}

{{/*
Web selector labels
*/}}
{{- define "control-plane.web.selectorLabels" -}}
{{ include "control-plane.selectorLabels" . }}
app.kubernetes.io/component: web
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "control-plane.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "control-plane.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
API full name
*/}}
{{- define "control-plane.api.fullname" -}}
{{- printf "%s-api" (include "control-plane.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Web full name
*/}}
{{- define "control-plane.web.fullname" -}}
{{- printf "%s-web" (include "control-plane.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Secret name for API
*/}}
{{- define "control-plane.api.secretName" -}}
{{- printf "%s-api-secret" (include "control-plane.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
ConfigMap name for API
*/}}
{{- define "control-plane.api.configMapName" -}}
{{- printf "%s-api-config" (include "control-plane.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Redis host - returns internal service name if subchart enabled, otherwise uses configured host
*/}}
{{- define "control-plane.redis.host" -}}
{{- if .Values.redis.enabled }}
{{- printf "%s-redis-master" (include "control-plane.fullname" .) }}
{{- else }}
{{- .Values.api.redis.host }}
{{- end }}
{{- end }}

{{/*
Redis password secret name
*/}}
{{- define "control-plane.redis.secretName" -}}
{{- if .Values.redis.enabled }}
{{- if .Values.redis.auth.existingSecret }}
{{- .Values.redis.auth.existingSecret }}
{{- else }}
{{- printf "%s-redis" (include "control-plane.fullname" .) }}
{{- end }}
{{- else if .Values.api.redis.existingSecret }}
{{- .Values.api.redis.existingSecret }}
{{- else }}
{{- include "control-plane.api.secretName" . }}
{{- end }}
{{- end }}

{{/*
Redis password secret key
*/}}
{{- define "control-plane.redis.secretKey" -}}
{{- if .Values.redis.enabled }}
{{- if .Values.redis.auth.existingSecretPasswordKey }}
{{- .Values.redis.auth.existingSecretPasswordKey }}
{{- else }}
{{- "redis-password" }}
{{- end }}
{{- else if .Values.api.redis.existingSecretKey }}
{{- .Values.api.redis.existingSecretKey }}
{{- else }}
{{- "redis-password" }}
{{- end }}
{{- end }}

{{/*
API image
*/}}
{{- define "control-plane.api.image" -}}
{{- $tag := .Values.api.image.tag | default .Chart.AppVersion }}
{{- printf "%s:%s" .Values.api.image.repository $tag }}
{{- end }}

{{/*
Web image
*/}}
{{- define "control-plane.web.image" -}}
{{- $tag := .Values.web.image.tag | default .Chart.AppVersion }}
{{- printf "%s:%s" .Values.web.image.repository $tag }}
{{- end }}

{{/*
TLS secret name
*/}}
{{- define "control-plane.tls.secretName" -}}
{{- if .Values.ingress.tls.existingSecret }}
{{- .Values.ingress.tls.existingSecret }}
{{- else }}
{{- printf "%s-tls" (include "control-plane.fullname" .) }}
{{- end }}
{{- end }}
