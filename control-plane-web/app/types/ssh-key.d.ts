/**
 * SSH Key types for the Control Plane.
 */

declare type TSSHKey = {
  _id: string
  name: string
  publicKey: string
  fingerprint: string
  type: 'ed25519' | 'rsa'
  isDefault: boolean
  createdAt: string
  updatedAt?: string
}

declare type TSSHKeyCreate = {
  name: string
  type: 'ed25519' | 'rsa'
  isDefault?: boolean
}

declare type TSSHKeyImport = {
  name: string
  privateKey: string
  isDefault?: boolean
}

declare type TSSHKeyUpdate = {
  name?: string
  isDefault?: boolean
}
