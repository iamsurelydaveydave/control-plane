declare type TServer = {
  _id: string
  name: string
  host: string
  status: string
  provider?: string
  sshUser: string
  sshPort: number
  sshKeyId?: string
}

declare type TServerForm = {
  name: string
  host: string
  sshUser: string
  sshPort: number
  sshKeyId?: string
}
