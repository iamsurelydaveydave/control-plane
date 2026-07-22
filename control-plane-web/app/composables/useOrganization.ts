/**
 * useOrganization — organization management composable for multi-tenancy.
 *
 * Manages the current organization context and provides organization-scoped API calls.
 */
export default function useOrganization() {
  const cookieConfig = useCookieConfig()

  // Current organization state
  const currentOrganization = useState<TOrganization | null>('currentOrganization', () => null)
  const organizations = useState<TOrganization[]>('organizations', () => [])

  // Persist selected org ID in cookie for cross-page context
  const orgCookie = useCookie<string | null>('orgId', {
    ...cookieConfig,
    maxAge: 60 * 60 * 24 * 365 // 1 year
  })

  /**
   * Fetch all organizations the current user belongs to.
   */
  async function getAll() {
    const data = await useNuxtApp().$api<{ organizations: TOrganization[] }>(
      '/organizations',
      { method: 'GET' }
    )
    organizations.value = data.organizations

    // Auto-select organization if not set
    if (!currentOrganization.value && organizations.value.length > 0) {
      // Check if saved org ID is still valid
      const savedOrgId = orgCookie.value
      const savedOrg = savedOrgId
        ? organizations.value.find(o => o._id === savedOrgId) ?? null
        : null

      // Use saved org or default to first
      await select(savedOrg ?? organizations.value[0] ?? null)
    }

    return data.organizations
  }

  /**
   * Select an organization as the current context.
   */
  async function select(org: TOrganization | null) {
    currentOrganization.value = org
    orgCookie.value = org?._id ?? null
  }

  /**
   * Create a new organization.
   */
  function create(data: { name: string, slug?: string, billingEmail?: string }) {
    return useNuxtApp().$api<{ message: string, organizationId: string }>(
      '/organizations',
      { method: 'POST', body: data }
    ).then(async (result) => {
      await getAll()
      return result
    })
  }

  /**
   * Get organization by ID.
   */
  function getById(id: string) {
    return useNuxtApp().$api<{ organization: TOrganization }>(
      `/organizations/${id}`,
      { method: 'GET' }
    ).then(data => data.organization)
  }

  /**
   * Update organization details.
   */
  function update(id: string, data: Partial<Pick<TOrganization, 'name' | 'slug' | 'billingEmail' | 'settings'>>) {
    return useNuxtApp().$api<{ message: string }>(
      `/organizations/${id}`,
      { method: 'PATCH', body: data }
    ).then(async (result) => {
      // Refresh current org if it was updated
      if (currentOrganization.value?._id === id) {
        const updated = await getById(id)
        currentOrganization.value = updated
      }
      return result
    })
  }

  /**
   * Delete an organization (owner only).
   */
  function remove(id: string) {
    return useNuxtApp().$api<{ message: string }>(
      `/organizations/${id}`,
      { method: 'DELETE' }
    ).then(async (result) => {
      // Clear current org if it was deleted
      if (currentOrganization.value?._id === id) {
        currentOrganization.value = null
        orgCookie.value = null
      }
      await getAll()
      return result
    })
  }

  /**
   * Get organization usage statistics.
   */
  function getUsage(id: string) {
    return useNuxtApp().$api<TOrganizationUsageStats>(
      `/organizations/${id}/usage`,
      { method: 'GET' }
    )
  }

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  /**
   * Get organization members.
   */
  function getMembers(id: string, params?: { page?: number, limit?: number }) {
    return useNuxtApp().$api<{ items: TOrganizationMember[], pages: number }>(
      `/organizations/${id}/members`,
      { method: 'GET', query: params }
    )
  }

  /**
   * Invite a new member to the organization.
   */
  function inviteMember(id: string, data: { email: string, roleId: string }) {
    return useNuxtApp().$api<{ message: string, inviteId: string, token: string }>(
      `/organizations/${id}/members`,
      { method: 'POST', body: data }
    )
  }

  /**
   * Remove a member from the organization.
   */
  function removeMember(orgId: string, userId: string) {
    return useNuxtApp().$api<{ message: string }>(
      `/organizations/${orgId}/members/${userId}`,
      { method: 'DELETE' }
    )
  }

  /**
   * Change a member's role.
   */
  function changeMemberRole(orgId: string, userId: string, roleId: string) {
    return useNuxtApp().$api<{ message: string }>(
      `/organizations/${orgId}/members/${userId}/role`,
      { method: 'POST', body: { roleId } }
    )
  }

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

  /**
   * Get pending invitations for an organization.
   */
  function getInvites(id: string, params?: { page?: number, limit?: number }) {
    return useNuxtApp().$api<{ items: TOrganizationInvite[], pages: number }>(
      `/organizations/${id}/invites`,
      { method: 'GET', query: params }
    )
  }

  /**
   * Revoke a pending invitation.
   */
  function revokeInvite(orgId: string, inviteId: string) {
    return useNuxtApp().$api<{ message: string }>(
      `/organizations/${orgId}/invites/${inviteId}`,
      { method: 'DELETE' }
    )
  }

  /**
   * Get invite details by token (for accepting invitations).
   */
  function getInviteByToken(token: string) {
    return useNuxtApp().$api<{
      invite: {
        email: string
        expiresAt: string
        acceptedAt?: string
        organization: { name: string, slug: string } | null
      }
    }>(
      `/invites/${token}`,
      { method: 'GET' }
    ).then(data => data.invite)
  }

  /**
   * Accept an invitation.
   */
  function acceptInvite(token: string) {
    return useNuxtApp().$api<{ message: string, organizationId: string }>(
      `/invites/${token}/accept`,
      { method: 'POST' }
    ).then(async (result) => {
      await getAll()
      return result
    })
  }

  // ---------------------------------------------------------------------------
  // Ownership
  // ---------------------------------------------------------------------------

  /**
   * Transfer organization ownership to another member.
   */
  function transferOwnership(orgId: string, newOwnerId: string) {
    return useNuxtApp().$api<{ message: string }>(
      `/organizations/${orgId}/transfer-ownership`,
      { method: 'POST', body: { newOwnerId } }
    ).then(async (result) => {
      // Refresh current org to reflect new owner
      if (currentOrganization.value?._id === orgId) {
        const updated = await getById(orgId)
        currentOrganization.value = updated
      }
      return result
    })
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if the current user is the owner of the current organization.
   */
  function isOwner(userId: string) {
    return currentOrganization.value?.ownerId === userId
  }

  /**
   * Get the organization ID header for API requests.
   * Add this to requests that need organization context.
   */
  function getOrgHeader(): Record<string, string> {
    if (!currentOrganization.value?._id) return {}
    return { 'X-Organization-Id': currentOrganization.value._id }
  }

  return {
    // State
    currentOrganization,
    organizations,
    // CRUD
    getAll,
    select,
    create,
    getById,
    update,
    remove,
    getUsage,
    // Members
    getMembers,
    inviteMember,
    removeMember,
    changeMemberRole,
    // Invitations
    getInvites,
    revokeInvite,
    getInviteByToken,
    acceptInvite,
    // Ownership
    transferOwnership,
    // Helpers
    isOwner,
    getOrgHeader
  }
}
