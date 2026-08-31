# Aura Vault Protocol — Kubernetes Deployment Guide

> **Issue:** [#397 — Document Kubernetes deployment configuration](https://github.com/soterika/aura-vault-protocol/issues/397)  
> **Audience:** DevOps engineers and platform teams deploying Aura Vault to a Kubernetes cluster.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Cluster Architecture Overview](#cluster-architecture-overview)
3. [Namespace Setup](#namespace-setup)
4. [RBAC Configuration](#rbac-configuration)
5. [Network Policies](#network-policies)
6. [Secrets Management](#secrets-management)
7. [Frontend Deployment](#frontend-deployment)
8. [Backend API Deployment](#backend-api-deployment)
9. [Database Deployment (PostgreSQL)](#database-deployment-postgresql)
10. [Redis Deployment](#redis-deployment)
11. [Monitoring Stack Deployment](#monitoring-stack-deployment)
12. [Horizontal Pod Autoscaling (HPA)](#horizontal-pod-autoscaling-hpa)
13. [Ingress Configuration](#ingress-configuration)
14. [Health Checks and Readiness](#health-checks-and-readiness)
15. [Rolling Updates and Rollback](#rolling-updates-and-rollback)
16. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| `kubectl` | 1.28+ | Cluster interaction |
| `helm` | 3.12+ | Chart-based deployments (monitoring stack) |
| `kubeseal` | 0.24+ | Sealed Secrets (optional, recommended for production) |

Install kubectl:
```bash
curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl && sudo mv kubectl /usr/local/bin/kubectl
kubectl version --client
```

Install Helm:
```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
helm version
```

### Required Cluster Capabilities

- Kubernetes 1.28 or later
- A default `StorageClass` for persistent volumes (e.g., `gp3` on EKS, `standard` on GKE)
- A container image registry accessible from the cluster (ECR, GCR, GHCR, or Docker Hub)
- An Ingress controller installed (e.g., `nginx-ingress`)
- `metrics-server` installed for HPA to function

Verify metrics-server is available:
```bash
kubectl top nodes
```

### Image Registry

Before deploying, build and push the application images:

```bash
# Frontend
docker build -t your-registry/aura-frontend:v0.2.0 ./frontend
docker push your-registry/aura-frontend:v0.2.0

# Backend API
docker build -t your-registry/aura-backend:v0.2.0 ./backend
docker push your-registry/aura-backend:v0.2.0
```

Replace `your-registry` with your actual image registry host.

---

## Cluster Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Kubernetes Cluster                                                  │
│                                                                     │
│  namespace: aura-vault                                              │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Ingress (nginx)                                               │ │
│  │    ├── /         → frontend (Service: ClusterIP, port 3000)   │ │
│  │    └── /api      → backend  (Service: ClusterIP, port 4000)   │ │
│  │                                                                │ │
│  │  Deployments                                                   │ │
│  │    ├── frontend   (2–10 replicas, HPA)                        │ │
│  │    ├── backend    (2–10 replicas, HPA)                        │ │
│  │    ├── postgres   (1 replica, StatefulSet)                    │ │
│  │    └── redis      (1 replica, StatefulSet)                    │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  namespace: aura-monitoring                                         │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  prometheus, grafana, loki, promtail, jaeger, alertmanager    │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

All manifests referenced in this guide should be placed in a `/k8s/` directory at the repo root:

```
k8s/
├── namespace.yaml
├── rbac/
│   ├── serviceaccount.yaml
│   ├── role.yaml
│   └── rolebinding.yaml
├── network-policies/
│   ├── default-deny.yaml
│   ├── allow-frontend-to-backend.yaml
│   └── allow-backend-to-db.yaml
├── secrets/
│   ├── sealed-secret-db.yaml      # committed (encrypted)
│   └── secret-template.yaml       # reference only, never committed
├── frontend/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── hpa.yaml
├── backend/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── hpa.yaml
├── postgres/
│   ├── statefulset.yaml
│   ├── service.yaml
│   └── pvc.yaml
├── redis/
│   ├── statefulset.yaml
│   └── service.yaml
├── monitoring/
│   └── values.yaml                # Helm values override
└── ingress.yaml
```

---

## Namespace Setup

Create two namespaces — one for the application and one for monitoring:

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: aura-vault
  labels:
    app.kubernetes.io/part-of: aura-vault-protocol
    environment: production
---
apiVersion: v1
kind: Namespace
metadata:
  name: aura-monitoring
  labels:
    app.kubernetes.io/part-of: aura-vault-protocol
    purpose: observability
```

Apply:
```bash
kubectl apply -f k8s/namespace.yaml
```

Verify:
```bash
kubectl get namespaces | grep aura
```

---

## RBAC Configuration

Aura Vault uses the least-privilege principle. Each component gets its own `ServiceAccount` with only the permissions it needs.

### Service Account

```yaml
# k8s/rbac/serviceaccount.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: aura-vault-sa
  namespace: aura-vault
  labels:
    app.kubernetes.io/name: aura-vault
automountServiceAccountToken: false
```

### Role (namespace-scoped)

```yaml
# k8s/rbac/role.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: aura-vault-role
  namespace: aura-vault
rules:
  # Allow reading ConfigMaps and Secrets (app config, vault keys)
  - apiGroups: [""]
    resources: ["configmaps", "secrets"]
    verbs: ["get", "list", "watch"]
  # Allow reading own pod metadata (for leader election, if needed)
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
```

### RoleBinding

```yaml
# k8s/rbac/rolebinding.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: aura-vault-rolebinding
  namespace: aura-vault
subjects:
  - kind: ServiceAccount
    name: aura-vault-sa
    namespace: aura-vault
roleRef:
  kind: Role
  apiGroup: rbac.authorization.k8s.io
  name: aura-vault-role
```

Apply RBAC:
```bash
kubectl apply -f k8s/rbac/
```

Verify the binding is correct:
```bash
kubectl auth can-i get secrets \
  --as=system:serviceaccount:aura-vault:aura-vault-sa \
  -n aura-vault
# Expected output: yes
```

---

## Network Policies

Network policies restrict which pods can communicate with each other. The default posture is **deny-all**, with explicit allow rules for each required flow.

### Default Deny-All

```yaml
# k8s/network-policies/default-deny.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: aura-vault
spec:
  podSelector: {}           # applies to all pods in namespace
  policyTypes:
    - Ingress
    - Egress
```

### Allow Frontend → Backend

```yaml
# k8s/network-policies/allow-frontend-to-backend.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: aura-vault
spec:
  podSelector:
    matchLabels:
      app: aura-backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: aura-frontend
      ports:
        - protocol: TCP
          port: 4000
```

### Allow Backend → Database and Redis

```yaml
# k8s/network-policies/allow-backend-to-db.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-backend-to-postgres
  namespace: aura-vault
spec:
  podSelector:
    matchLabels:
      app: postgres
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: aura-backend
      ports:
        - protocol: TCP
          port: 5432
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-backend-to-redis
  namespace: aura-vault
spec:
  podSelector:
    matchLabels:
      app: redis
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: aura-backend
      ports:
        - protocol: TCP
          port: 6379
```

### Allow Prometheus → App Metrics Scraping

```yaml
# k8s/network-policies/allow-prometheus-scrape.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-prometheus-scrape
  namespace: aura-vault
spec:
  podSelector:
    matchLabels:
      app: aura-backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: aura-monitoring
      ports:
        - protocol: TCP
          port: 9090
```

Apply all network policies:
```bash
kubectl apply -f k8s/network-policies/
```

---

## Secrets Management

### Option A: Kubernetes Native Secrets (Development / Staging)

> ⚠️ Native Secrets are base64-encoded, not encrypted at rest by default. Enable [etcd encryption](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/) before using in production, or use Option B.

```yaml
# k8s/secrets/secret-template.yaml  — DO NOT COMMIT with real values
apiVersion: v1
kind: Secret
metadata:
  name: aura-vault-secrets
  namespace: aura-vault
type: Opaque
stringData:
  DATABASE_URL: "postgresql://aura:changeme@postgres:5432/aura_vault"
  REDIS_URL: "redis://redis:6379"
  SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org"
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015"
  CONTRACT_ID: "<your-contract-id>"
  ADMIN_SECRET_KEY: "<admin-stellar-keypair>"
  GF_ADMIN_PASSWORD: "changeme-in-production"
```

Apply:
```bash
kubectl apply -f k8s/secrets/secret-template.yaml
```

### Option B: Sealed Secrets (Production — Recommended)

[Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) encrypts secrets with a cluster-specific key so the encrypted YAML is safe to commit to Git.

Install the controller:
```bash
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm install sealed-secrets -n kube-system \
  --set-string fullnameOverride=sealed-secrets-controller \
  sealed-secrets/sealed-secrets
```

Seal a secret:
```bash
# Create a plain secret manifest first (do not apply it)
kubectl create secret generic aura-vault-secrets \
  --namespace aura-vault \
  --from-literal=DATABASE_URL='postgresql://aura:changeme@postgres:5432/aura_vault' \
  --from-literal=REDIS_URL='redis://redis:6379' \
  --dry-run=client -o yaml | \
  kubeseal --format yaml > k8s/secrets/sealed-secret.yaml

# Commit k8s/secrets/sealed-secret.yaml — it is safe to store in Git
git add k8s/secrets/sealed-secret.yaml
```

Apply the sealed secret:
```bash
kubectl apply -f k8s/secrets/sealed-secret.yaml
```

The controller automatically decrypts and creates the corresponding `Secret` in the namespace.

---

## Frontend Deployment

```yaml
# k8s/frontend/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aura-frontend
  namespace: aura-vault
  labels:
    app: aura-frontend
    version: "0.2.0"
spec:
  replicas: 2
  selector:
    matchLabels:
      app: aura-frontend
  template:
    metadata:
      labels:
        app: aura-frontend
    spec:
      serviceAccountName: aura-vault-sa
      containers:
        - name: frontend
          image: your-registry/aura-frontend:v0.2.0
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: "production"
            - name: NEXT_PUBLIC_SOROBAN_RPC_URL
              valueFrom:
                secretKeyRef:
                  name: aura-vault-secrets
                  key: SOROBAN_RPC_URL
            - name: NEXT_PUBLIC_NETWORK_PASSPHRASE
              valueFrom:
                secretKeyRef:
                  name: aura-vault-secrets
                  key: NETWORK_PASSPHRASE
            - name: NEXT_PUBLIC_CONTRACT_ID
              valueFrom:
                secretKeyRef:
                  name: aura-vault-secrets
                  key: CONTRACT_ID
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 30
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: aura-frontend
---
# k8s/frontend/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: aura-frontend
  namespace: aura-vault
spec:
  selector:
    app: aura-frontend
  ports:
    - port: 80
      targetPort: 3000
  type: ClusterIP
```

---

## Backend API Deployment

```yaml
# k8s/backend/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aura-backend
  namespace: aura-vault
  labels:
    app: aura-backend
    version: "0.2.0"
spec:
  replicas: 2
  selector:
    matchLabels:
      app: aura-backend
  template:
    metadata:
      labels:
        app: aura-backend
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "4000"
        prometheus.io/path: "/metrics"
    spec:
      serviceAccountName: aura-vault-sa
      containers:
        - name: backend
          image: your-registry/aura-backend:v0.2.0
          ports:
            - containerPort: 4000
          envFrom:
            - secretRef:
                name: aura-vault-secrets
          resources:
            requests:
              cpu: "200m"
              memory: "256Mi"
            limits:
              cpu: "1000m"
              memory: "1Gi"
          readinessProbe:
            httpGet:
              path: /health
              port: 4000
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: 4000
            initialDelaySeconds: 30
            periodSeconds: 30
---
# k8s/backend/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: aura-backend
  namespace: aura-vault
spec:
  selector:
    app: aura-backend
  ports:
    - port: 4000
      targetPort: 4000
  type: ClusterIP
```

---

## Database Deployment (PostgreSQL)

PostgreSQL is deployed as a `StatefulSet` to guarantee stable network identity and persistent storage.

```yaml
# k8s/postgres/statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: aura-vault
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16.3-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: aura_vault
            - name: POSTGRES_USER
              value: aura
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: aura-vault-secrets
                  key: POSTGRES_PASSWORD
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "2Gi"
          volumeMounts:
            - name: postgres-data
              mountPath: /var/lib/postgresql/data
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "aura", "-d", "aura_vault"]
            initialDelaySeconds: 5
            periodSeconds: 10
  volumeClaimTemplates:
    - metadata:
        name: postgres-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: gp3        # adjust for your cloud provider
        resources:
          requests:
            storage: 20Gi
---
# k8s/postgres/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: aura-vault
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
  clusterIP: None    # headless service for StatefulSet
```

> **Backups:** Configure a `CronJob` to run `pg_dump` daily and upload to object storage (S3, GCS). Never run `DROP DATABASE` in production without a verified backup.

---

## Redis Deployment

Redis is used for session caching and rate-limiting in the backend.

```yaml
# k8s/redis/statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
  namespace: aura-vault
spec:
  serviceName: redis
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7.2-alpine
          ports:
            - containerPort: 6379
          command:
            - redis-server
            - --requirepass
            - $(REDIS_PASSWORD)
            - --maxmemory
            - 256mb
            - --maxmemory-policy
            - allkeys-lru
          env:
            - name: REDIS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: aura-vault-secrets
                  key: REDIS_PASSWORD
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          volumeMounts:
            - name: redis-data
              mountPath: /data
          readinessProbe:
            exec:
              command: ["redis-cli", "ping"]
            initialDelaySeconds: 5
            periodSeconds: 10
  volumeClaimTemplates:
    - metadata:
        name: redis-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: gp3
        resources:
          requests:
            storage: 5Gi
---
# k8s/redis/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: aura-vault
spec:
  selector:
    app: redis
  ports:
    - port: 6379
      targetPort: 6379
  clusterIP: None
```

---

## Monitoring Stack Deployment

Deploy the monitoring stack to the `aura-monitoring` namespace using the Prometheus community Helm chart.

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
```

### Install kube-prometheus-stack (includes Prometheus + Grafana + Alertmanager)

```bash
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace aura-monitoring \
  --create-namespace \
  --values k8s/monitoring/values.yaml \
  --version 61.0.0
```

Sample `k8s/monitoring/values.yaml`:

```yaml
# k8s/monitoring/values.yaml
prometheus:
  prometheusSpec:
    retention: 30d
    storageSpec:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 50Gi
    # Scrape custom alert rules from the aura-vault namespace
    additionalScrapeConfigs:
      - job_name: aura-vault-api
        kubernetes_sd_configs:
          - role: pod
            namespaces:
              names: [aura-vault]
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
            action: keep
            regex: "true"
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
            action: replace
            target_label: __metrics_path__
            regex: (.+)
          - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
            action: replace
            target_label: __address__
            regex: ([^:]+)(?::\d+)?;(\d+)
            replacement: $1:$2

grafana:
  adminPassword: "change-this-in-production"
  persistence:
    enabled: true
    storageClassName: gp3
    size: 10Gi
  ingress:
    enabled: true
    ingressClassName: nginx
    hosts:
      - grafana.your-domain.com

alertmanager:
  alertmanagerSpec:
    storage:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          resources:
            requests:
              storage: 5Gi
```

### Apply Existing Alert Rules as a PrometheusRule

```yaml
# k8s/monitoring/prometheus-rules.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: aura-vault-alerts
  namespace: aura-monitoring
  labels:
    release: kube-prometheus-stack
spec:
  groups:
    - name: aura-vault-critical
      rules:
        - alert: ServiceDown
          expr: up == 0
          for: 1m
          labels:
            severity: critical
          annotations:
            summary: "Service {{ $labels.job }} is down"
            description: "{{ $labels.instance }} unreachable for more than 1 minute."

        - alert: HighErrorRate
          expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "High error rate on {{ $labels.job }}"

        - alert: HighLatency
          expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High p95 latency on {{ $labels.job }}"

        - alert: HighMemoryUsage
          expr: process_resident_memory_bytes / 1024 / 1024 > 512
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "High memory usage on {{ $labels.job }}"

    - name: aura-vault-sla
      rules:
        - alert: SLABreachAvailability
          expr: avg_over_time(up{job="aura-vault-api"}[1h]) < 0.999
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "SLA breach: availability below 99.9%"

        - alert: SLABreachLatency
          expr: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{job="aura-vault-api"}[1h])) > 5
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "SLA breach: p99 latency above 5s"

    - name: aura-vault-blockchain
      rules:
        - alert: TransactionFailureRate
          expr: rate(blockchain_transactions_total{status="failed"}[10m]) / rate(blockchain_transactions_total[10m]) > 0.1
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "High blockchain transaction failure rate"

        - alert: VaultBalanceLow
          expr: vault_balance_xlm < 100
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Vault balance is low (current: {{ $value }})"
```

```bash
kubectl apply -f k8s/monitoring/prometheus-rules.yaml
```

### Install Loki and Promtail

```bash
helm install loki grafana/loki-stack \
  --namespace aura-monitoring \
  --set loki.persistence.enabled=true \
  --set loki.persistence.size=20Gi \
  --set promtail.enabled=true
```

---

## Horizontal Pod Autoscaling (HPA)

HPA scales replicas up or down based on CPU and memory utilisation. The `metrics-server` addon must be installed in the cluster.

### Frontend HPA

```yaml
# k8s/frontend/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: aura-frontend-hpa
  namespace: aura-vault
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: aura-frontend
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300   # 5-min cooldown before scaling down
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120
```

### Backend HPA

```yaml
# k8s/backend/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: aura-backend-hpa
  namespace: aura-vault
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: aura-backend
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 75
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 15
      policies:
        - type: Pods
          value: 3
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120
```

### HPA Scaling Behaviour Explained

| Parameter | Value | Effect |
|-----------|-------|--------|
| `minReplicas` | 2 | Always run at least 2 pods per deployment (HA) |
| `maxReplicas` | 10 | Hard cap to prevent cost runaway |
| CPU scale-up threshold | 70% | Scale up when average CPU exceeds 70% |
| Memory scale-up threshold | 80% | Scale up when average memory exceeds 80% |
| Scale-up window | 30–60s | Reacts quickly to traffic spikes |
| Scale-down window | 300s | Waits 5 minutes before removing pods to absorb burst tail |
| Scale-down increment | 1 pod per 2 min | Gradual scale-down avoids yo-yo behaviour |

Inspect current HPA status:
```bash
kubectl get hpa -n aura-vault
kubectl describe hpa aura-backend-hpa -n aura-vault
```

Apply all HPAs:
```bash
kubectl apply -f k8s/frontend/hpa.yaml
kubectl apply -f k8s/backend/hpa.yaml
```

---

## Ingress Configuration

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: aura-vault-ingress
  namespace: aura-vault
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "60"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"    # if using cert-manager
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - app.your-domain.com
      secretName: aura-vault-tls
  rules:
    - host: app.your-domain.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: aura-backend
                port:
                  number: 4000
          - path: /
            pathType: Prefix
            backend:
              service:
                name: aura-frontend
                port:
                  number: 80
```

---

## Health Checks and Readiness

Both frontend and backend expose health endpoints that Kubernetes probes use to determine pod readiness.

| Service | Path | Expected Response |
|---------|------|-------------------|
| Frontend | `GET /api/health` | `200 OK` |
| Backend | `GET /health` | `200 OK` with `{"status":"ok"}` |
| Postgres | `pg_isready` exec probe | exit code 0 |
| Redis | `redis-cli ping` exec probe | `PONG` |

Readiness vs Liveness distinction:
- **readinessProbe** — gates traffic. Pod only receives requests when ready. Failed readiness temporarily removes the pod from the Service endpoints without restarting it.
- **livenessProbe** — detects deadlocks. Failed liveness restarts the container.

---

## Rolling Updates and Rollback

### Update Strategy

All Deployments use `RollingUpdate` (the default). Adding explicit settings ensures zero-downtime deploys:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0     # never take a pod down before a new one is ready
    maxSurge: 1           # spin up one extra pod during the rollout
```

### Performing a Deployment Update

```bash
# Update image to a new tag
kubectl set image deployment/aura-frontend \
  frontend=your-registry/aura-frontend:v0.3.0 \
  -n aura-vault

# Watch the rollout
kubectl rollout status deployment/aura-frontend -n aura-vault
```

### Rollback

```bash
# Roll back to the previous revision
kubectl rollout undo deployment/aura-frontend -n aura-vault

# Roll back to a specific revision
kubectl rollout history deployment/aura-frontend -n aura-vault
kubectl rollout undo deployment/aura-frontend --to-revision=2 -n aura-vault
```

---

## Troubleshooting

### Pod is in `CrashLoopBackOff`

```bash
# Get the last container logs
kubectl logs -n aura-vault deployment/aura-backend --previous

# Describe the pod for events
kubectl describe pod -n aura-vault -l app=aura-backend
```

### Pod is in `Pending` state

Likely causes: insufficient node resources, PVC not bound, or scheduling constraints.

```bash
kubectl describe pod -n aura-vault <pod-name>
# Look for "Events" section at the bottom
```

### `ImagePullBackOff`

The cluster cannot pull the image. Check registry credentials:

```bash
# Create a registry pull secret (if using a private registry)
kubectl create secret docker-registry registry-creds \
  --docker-server=your-registry \
  --docker-username=<user> \
  --docker-password=<token> \
  -n aura-vault

# Reference it in the Deployment spec
# spec.imagePullSecrets:
#   - name: registry-creds
```

### HPA shows `<unknown>` for metrics

The `metrics-server` is not installed or not reachable:

```bash
kubectl top pods -n aura-vault
# If this errors, install metrics-server:
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

### Network policy blocking traffic

Temporarily remove network policies to isolate connectivity issues:

```bash
kubectl delete networkpolicy default-deny-all -n aura-vault
# Test connectivity, then re-apply when root cause is found
kubectl apply -f k8s/network-policies/
```

### Verify all resources are running

```bash
kubectl get all -n aura-vault
kubectl get all -n aura-monitoring
kubectl get hpa -n aura-vault
kubectl get ingress -n aura-vault
```

---

## Full Deployment Order

Apply all manifests in this order to respect dependencies:

```bash
# 1. Namespaces
kubectl apply -f k8s/namespace.yaml

# 2. RBAC
kubectl apply -f k8s/rbac/

# 3. Secrets
kubectl apply -f k8s/secrets/sealed-secret.yaml

# 4. Network policies
kubectl apply -f k8s/network-policies/

# 5. Stateful services (DB + Redis)
kubectl apply -f k8s/postgres/
kubectl apply -f k8s/redis/

# 6. Application workloads
kubectl apply -f k8s/frontend/
kubectl apply -f k8s/backend/

# 7. Ingress
kubectl apply -f k8s/ingress.yaml

# 8. Monitoring
helm upgrade --install kube-prometheus-stack ... (see Monitoring section)
kubectl apply -f k8s/monitoring/prometheus-rules.yaml
```

---

*Related documentation: [docs/DEPLOYMENT.md](DEPLOYMENT.md) — Docker-based local deployment guide.*
