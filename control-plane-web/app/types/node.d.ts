// =============================================================================
// Enums
// =============================================================================

declare type TNodeRole = 'master' | 'worker'

declare type TNodeStatus =
  | 'pending'       // Created in DB, waiting for provisioning
  | 'provisioning'  // SSH connected, installing k3s agent
  | 'joining'       // k3s agent installed, waiting for K8s Ready
  | 'ready'         // K8s node is Ready
  | 'not-ready'     // K8s node exists but not Ready
  | 'offline'       // Node unreachable
  | 'draining'      // Being drained before removal
  | 'deleting'      // Being removed from cluster
  | 'failed'        // Provisioning failed

declare type TProvisioningStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

declare type TProvisioningStep = {
  name: string
  label: string
  status: TProvisioningStepStatus
  output?: string
  error?: string
  startedAt?: string
  completedAt?: string
}

// =============================================================================
// Types
// =============================================================================

declare type TNodeCondition = {
  type: string           // Ready, MemoryPressure, DiskPressure, PIDPressure, NetworkUnavailable
  status: string         // True, False, Unknown
  reason?: string
  message?: string
  lastTransitionTime?: string
}

declare type TNodeTaint = {
  key: string
  value?: string
  effect: string         // NoSchedule, PreferNoSchedule, NoExecute
}

declare type TNodeResources = {
  cpuCapacity: string        // e.g., "4"
  cpuAllocatable: string     // e.g., "3800m"
  memoryCapacity: string     // e.g., "8Gi"
  memoryAllocatable: string  // e.g., "7Gi"
  podsCapacity: string       // e.g., "110"
  podsRunning?: number       // Current pod count
}

declare type TNode = {
  _id: string
  clusterId: string
  name: string               // Display name, e.g., "worker-1"
  role: TNodeRole
  host: string               // IP address or hostname

  // SSH connection info (for provisioning)
  sshUser?: string           // SSH username (default: root)
  sshPort?: number           // SSH port (default: 22)
  sshKeyId?: string          // Reference to SSH key in secrets

  // K8s node info (synced from cluster)
  k8sName?: string           // Actual K8s node name
  k8sStatus?: string         // Ready, NotReady, Unknown
  k8sVersion?: string        // kubelet version
  containerRuntime?: string  // e.g., "containerd://1.7.0"
  osImage?: string           // e.g., "Ubuntu 22.04.3 LTS"
  architecture?: string      // e.g., "amd64"

  // Resources (synced from K8s)
  resources?: TNodeResources

  // Conditions (synced from K8s)
  conditions?: TNodeCondition[]

  // Labels & taints
  labels?: Record<string, string>
  taints?: TNodeTaint[]

  // Scheduling
  unschedulable?: boolean

  // Join info (for workers)
  joinToken?: string         // Encrypted k3s token
  joinCommand?: string       // Full command for copy/paste

  // Provisioning status
  provisioningStatus?: 'idle' | 'running' | 'success' | 'failed'
  provisioningLog?: TProvisioningStep[]
  provisioningStartedAt?: string
  provisioningCompletedAt?: string

  // Status
  status: TNodeStatus
  statusMessage?: string

  // Timestamps
  joinedAt?: string
  lastSeenAt?: string
  createdAt: string
  updatedAt: string
}

// =============================================================================
// Form / Input Types
// =============================================================================

declare type TNodeForm = {
  clusterId: string
  name: string
  role?: TNodeRole
  host?: string
  sshUser?: string
  sshPort?: number
  sshKeyId?: string
}

declare type TNodeProvisionInput = {
  clusterId: string
  name: string
  host: string
  sshUser?: string           // default: root
  sshPort?: number           // default: 22
  sshKeyId: string
}

// =============================================================================
// API Response Types
// =============================================================================

declare type TJoinTokenResponse = {
  joinToken: string
  joinCommand: string
  nodeName: string
  expiresAt?: string
}

declare type TTestConnectionResponse = {
  success: boolean
  error?: string
  serverInfo?: {
    os: string
    hostname: string
  }
}
