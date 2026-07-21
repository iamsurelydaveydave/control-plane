/**
 * Organization plan types and limits.
 */
declare type TOrganizationPlan = 'free' | 'starter' | 'pro' | 'enterprise'

declare type TOrganizationLimits = {
  maxApps: number
  maxResources: number
  maxUsers: number
  maxStorage: number // GB, -1 = unlimited
}

declare type TOrganizationUsage = {
  apps: number
  resources: number
  users: number
  storage: number // GB
}

declare type TOrganizationSettings = {
  defaultClusterId?: string
  allowedDomains?: string[] // Restrict user email domains
}

/**
 * Organization type for multi-tenancy.
 */
declare type TOrganization = {
  _id: string
  name: string
  slug: string // URL-friendly identifier
  plan: TOrganizationPlan
  limits: TOrganizationLimits
  usage: TOrganizationUsage
  settings: TOrganizationSettings
  billingEmail?: string
  ownerId: string
  createdAt: string
  updatedAt: string
  // Included when fetching user's organizations
  membership?: {
    roleId: string
    joinedAt: string
  }
}

/**
 * Organization member type.
 */
declare type TOrganizationMember = {
  _id: string
  organizationId: string
  userId: string
  roleId: string
  invitedBy?: string
  invitedAt?: string
  joinedAt: string
}

/**
 * Organization invite type.
 */
declare type TOrganizationInvite = {
  _id: string
  organizationId: string
  email: string
  roleId: string
  token: string
  invitedBy: string
  expiresAt: string
  acceptedAt?: string
  createdAt: string
}

/**
 * Organization usage statistics.
 */
declare type TOrganizationUsageStats = {
  usage: TOrganizationUsage
  limits: TOrganizationLimits
  plan: TOrganizationPlan
  percentages: {
    apps: number
    resources: number
    users: number
    storage: number
  }
}
