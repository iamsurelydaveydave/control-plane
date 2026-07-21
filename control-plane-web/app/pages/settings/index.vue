<template>
  <HubLinks
    title="Settings"
    subtitle="Manage SSH keys, API tokens, and configuration."
    :items="items"
  />
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const items = [
  {
    title: 'SSH Keys',
    description: 'Manage SSH keys for server access.',
    icon: 'i-lucide-key',
    to: '/settings/ssh-keys',
    status: 'active' as const
  },
  {
    title: 'API Tokens',
    description: 'Manage API tokens for programmatic access.',
    icon: 'i-lucide-code',
    to: '/settings/api-tokens',
    status: 'active' as const
  },
  {
    title: 'DNS',
    description: 'Connect Cloudflare to get mongodb+srv:// URLs for replica sets.',
    icon: 'i-lucide-globe',
    to: '/settings/dns',
    status: 'active' as const
  },
  {
    title: 'Kubernetes',
    description: 'K3s cluster status and database provisioning settings.',
    icon: 'i-lucide-ship',
    to: '/settings/kubernetes',
    status: 'active' as const
  },
  {
    title: 'Single Sign-On',
    description: 'Configure SAML or OIDC for enterprise authentication.',
    icon: 'i-lucide-shield-check',
    to: '/settings/sso',
    status: 'active' as const
  },
  {
    title: 'Account',
    description: 'Manage your account and preferences.',
    icon: 'i-lucide-user',
    to: '/settings/account',
    status: 'active' as const
  },
  {
    title: 'Appearance',
    description: 'Customize theme and display settings.',
    icon: 'i-lucide-palette',
    to: '/settings/appearance',
    status: 'active' as const
  }
]

useHead({ title: 'Settings · Control Plane' })
</script>
