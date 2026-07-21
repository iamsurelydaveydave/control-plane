/**
 * Secret types for Control Plane.
 */

declare type TSecretType = 'env' | 'ssh-private-key' | 'tls-cert' | 'tls-key' | 'generic'

declare type TSecret = {
  _id: string
  name: string
  type?: TSecretType
  appId?: string
  description?: string
  createdAt: string
  updatedAt: string
  // Note: value is never returned from API for security
}

declare type TSecretCreate = {
  name: string
  value: string
  type?: TSecretType
  appId?: string
  description?: string
}

declare type TSecretUpdate = {
  value?: string
  description?: string
}
