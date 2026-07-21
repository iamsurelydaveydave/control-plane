declare type TSSOType = 'saml' | 'oidc'

declare type TSSOStatus = 'pending' | 'active' | 'inactive' | 'failed'

declare type TSSOSAMLConfig = {
  entityId: string
  ssoUrl: string
  certificate: string
  signRequest?: boolean
}

declare type TSSSOIDCConfig = {
  issuer: string
  clientId: string
  clientSecret?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  userInfoEndpoint?: string
  scopes?: string[]
}

declare type TSSConfig = {
  _id: string
  name: string
  type: TSSOType
  status: TSSOStatus
  domain: string
  saml?: TSSOSAMLConfig
  oidc?: TSSSOIDCConfig
  isDefault: boolean
  lastTestedAt?: string
  createdAt?: string
  updatedAt?: string
}

declare type TSSOConfigForm = {
  name: string
  type: TSSOType
  domain: string
  saml?: TSSOSAMLConfig
  oidc?: Omit<TSSSOIDCConfig, 'clientSecret'> & { clientSecret?: string }
  isDefault?: boolean
}
