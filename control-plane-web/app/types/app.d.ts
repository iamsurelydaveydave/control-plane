declare type TApp = {
  _id: string
  name: string
  image: string
  status: string
  desiredReplicas: number
  serverIds: string[]
}

declare type TAppForm = {
  name: string
  image: string
  desiredReplicas: number
  serverIds: string[]
}
