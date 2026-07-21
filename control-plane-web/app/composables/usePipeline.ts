/**
 * usePipeline — pipeline resource composable following control-plane-web pattern.
 *
 * Returns reactive state and API functions. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function usePipeline() {
  const pipeline = ref<TPipeline>({
    _id: '',
    name: '',
    appId: '',
    status: 'idle',
    stages: []
  })

  function getAll(options: { page?: number, search?: string } = {}) {
    return useNuxtApp().$api<{ items: TPipeline[], pages: number }>('/pipelines', {
      method: 'GET',
      query: { page: options.page ?? 1, search: options.search ?? '' }
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<{ pipeline: TPipeline }>(`/pipelines/${id}`, {
      method: 'GET'
    })
  }

  function add(value: TPipelineForm) {
    return useNuxtApp().$api<{ message: string, pipelineId: string }>('/pipelines', {
      method: 'POST',
      body: value
    })
  }

  function updateById(id: string, value: Partial<TPipelineForm>) {
    return useNuxtApp().$api<{ message: string }>(`/pipelines/${id}`, {
      method: 'PATCH',
      body: value
    })
  }

  function deleteById(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/pipelines/${id}`, {
      method: 'DELETE'
    })
  }

  function deployToStage(id: string, stage: TPipelineStage, options?: { version?: string }) {
    return useNuxtApp().$api<{ message: string, deploymentId: string }>(`/pipelines/${id}/deploy`, {
      method: 'POST',
      body: { stage, version: options?.version }
    })
  }

  function promoteStage(id: string, fromStage: TPipelineStage, toStage: TPipelineStage) {
    return useNuxtApp().$api<{ message: string, promotionId: string }>(`/pipelines/${id}/promote`, {
      method: 'POST',
      body: { fromStage, toStage }
    })
  }

  function getPromotionHistory(id: string) {
    return useNuxtApp().$api<{ items: TPromotionHistoryEntry[] }>(`/pipelines/${id}/promotions`, {
      method: 'GET'
    })
  }

  function rollbackStage(id: string, stage: TPipelineStage, version: string) {
    return useNuxtApp().$api<{ message: string }>(`/pipelines/${id}/rollback`, {
      method: 'POST',
      body: { stage, version }
    })
  }

  return {
    pipeline,
    getAll,
    getById,
    add,
    updateById,
    deleteById,
    deployToStage,
    promoteStage,
    getPromotionHistory,
    rollbackStage
  }
}
