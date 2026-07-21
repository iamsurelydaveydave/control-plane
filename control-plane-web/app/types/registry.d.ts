declare type TRegistryType = 'dockerhub' | 'gcr' | 'ecr' | 'acr' | 'ghcr' | 'custom'

declare type TRegistryStatus = 'pending' | 'verified' | 'failed'

declare type TRegistry = {
  _id: string
  name: string
  type: TRegistryType
  url: string
  username?: string
  status: TRegistryStatus
  isDefault: boolean
  lastVerifiedAt?: string
  createdAt?: string
  updatedAt?: string
}

declare type TRegistryForm = {
  name: string
  type: TRegistryType
  url: string
  username?: string
  password?: string
  isDefault?: boolean
}
