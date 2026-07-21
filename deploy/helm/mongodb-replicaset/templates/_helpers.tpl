{{/*
Expand the name of the chart.
*/}}
{{- define "mongodb-replicaset.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "mongodb-replicaset.fullname" -}}
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
{{- define "mongodb-replicaset.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "mongodb-replicaset.labels" -}}
helm.sh/chart: {{ include "mongodb-replicaset.chart" . }}
{{ include "mongodb-replicaset.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: control-plane
{{- with .Values.controlPlane.labels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "mongodb-replicaset.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mongodb-replicaset.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
MongoDB service name (from subchart)
*/}}
{{- define "mongodb-replicaset.mongodb.fullname" -}}
{{- printf "%s-mongodb" (include "mongodb-replicaset.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
MongoDB headless service name
*/}}
{{- define "mongodb-replicaset.mongodb.headless" -}}
{{- printf "%s-mongodb-headless" (include "mongodb-replicaset.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Connection string for the replica set
*/}}
{{- define "mongodb-replicaset.connectionString" -}}
{{- $replicaCount := int .Values.mongodb.replicaCount }}
{{- $rsName := .Values.mongodb.replicaSetName }}
{{- $headless := include "mongodb-replicaset.mongodb.headless" . }}
{{- $namespace := .Release.Namespace }}
{{- $port := 27017 }}
{{- $hosts := list }}
{{- range $i := until $replicaCount }}
{{- $hosts = append $hosts (printf "%s-mongodb-%d.%s.%s.svc.cluster.local:%d" (include "mongodb-replicaset.fullname" $) $i $headless $namespace $port) }}
{{- end }}
mongodb://{{ join "," $hosts }}/?replicaSet={{ $rsName }}
{{- end }}
