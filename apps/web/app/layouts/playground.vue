<script setup lang="ts">
// Playground shell: makes sure the visitor has a session (guest by default, ADR 0007)
// and shows who they are in the header.
const { identity, refresh, signInAsGuest, signOut } = useAuth()
const config = useRuntimeConfig()
const route = useRoute()

const needsChallenge = ref(false)
const failed = ref(false)

const authError = computed(() =>
  typeof route.query.auth_error === 'string' ? route.query.auth_error : null,
)

async function startGuest(captchaToken?: string) {
  try {
    await signInAsGuest(captchaToken)
    needsChallenge.value = false
  }
  catch {
    failed.value = true
  }
}

onMounted(async () => {
  try {
    if (await refresh()) {
      return
    }
    if (config.public.turnstileSiteKey) {
      needsChallenge.value = true
    }
    else {
      await startGuest()
    }
  }
  catch {
    failed.value = true
  }
})

async function onSignOut() {
  await signOut()
  await navigateTo('/')
}
</script>

<template>
  <div class="shell">
    <header class="site-header">
      <NuxtLink to="/" class="brand">gradi-playground</NuxtLink>
      <div class="identity">
        <template v-if="identity?.kind === 'google'">
          <span>{{ identity.name ?? 'Google user' }}</span>
          <button type="button" class="link-button" @click="onSignOut">Sign out</button>
        </template>
        <template v-else-if="identity?.kind === 'guest'">
          <span>guest</span>
          <a href="/auth/google">Sign in with Google</a>
        </template>
      </div>
    </header>

    <p v-if="authError" class="notice">
      Sign-in did not complete ({{ authError }}). Please try again.
    </p>

    <TurnstileWidget
      v-if="needsChallenge"
      :site-key="config.public.turnstileSiteKey"
      @token="startGuest"
      @failed="failed = true"
    />

    <p v-if="failed" class="notice">
      Could not start a guest session. Reload the page to try again.
    </p>
    <slot v-if="identity" />
    <p v-else-if="!failed" class="page">Preparing your guest session…</p>

    <footer class="site-footer">
      <a href="https://github.com/gradiputera/gradi-playground">Source code</a>
      <span>MIT License</span>
    </footer>
  </div>
</template>
