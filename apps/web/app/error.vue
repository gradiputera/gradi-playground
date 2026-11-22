<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const notFound = computed(() => props.error.statusCode === 404)
const heading = computed(() => (notFound.value ? 'Page not found' : 'Something went wrong'))

useHead({ title: () => `${heading.value} · gradi-playground` })

function goHome() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <NuxtLayout>
    <main class="page">
      <h1>{{ heading }}</h1>
      <p v-if="notFound">This page does not exist.</p>
      <p v-else>An unexpected error occurred. Please try again later.</p>
      <a href="/" @click.prevent="goHome">Back to the main page</a>
    </main>
  </NuxtLayout>
</template>
