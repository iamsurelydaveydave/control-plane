/**
 * API Token types for the Control Plane.
 */

declare type TAPITokenScope
  = | 'servers:read'
    | 'servers:write'
    | 'apps:read'
    | 'apps:write'
    | 'addons:read'
    | 'addons:write'
    | 'deployments:read'
    | 'deployments:write'
    | 'settings:read'
    | 'settings:write'
    | '*'

declare type TAPIToken = {
  _id: string
  name: string
  tokenPrefix: string
  scopes: TAPITokenScope[]
  expiresAt?: string
  lastUsedAt?: string
  createdAt: string
  updatedAt?: string
}

declare type TAPITokenCreate = {
  name: string
  scopes?: TAPITokenScope[]
  expiresInDays?: number
}
