<script setup lang="ts">
// Cloudflare Turnstile, loaded only on the client when a site key is configured.
// The token goes to the BFF, which passes it to Supabase Auth for verification.
interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
}

const props = defineProps<{ siteKey: string }>()
const emit = defineEmits<{ token: [value: string], failed: [] }>()
const container = ref<HTMLElement | null>(null)

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

function turnstile(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile
}

function loadScript(): Promise<void> {
  if (turnstile()) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Turnstile script failed to load'))
    document.head.appendChild(script)
  })
}

onMounted(async () => {
  try {
    await loadScript()
    const api = turnstile()
    if (!api || !container.value) {
      throw new Error('Turnstile is not available')
    }
    api.render(container.value, {
      'sitekey': props.siteKey,
      'callback': (token: string) => emit('token', token),
      'error-callback': () => emit('failed'),
    })
  }
  catch {
    emit('failed')
  }
})
</script>

<template>
  <div ref="container" class="turnstile" />
</template>
