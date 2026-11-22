<script setup lang="ts">
import { profile } from '~/content/profile'

useSeoMeta({
  title: profile.seo.title,
  description: profile.seo.description,
})
</script>

<template>
  <main class="page">
    <section>
      <h1>{{ profile.name }}</h1>
      <p class="headline">{{ profile.headline }}</p>
      <p>{{ profile.intro }}</p>
      <NuxtLink to="/playground" class="cta">Open the playground</NuxtLink>
    </section>

    <section>
      <h2>What this demonstrates</h2>
      <ul>
        <li v-for="item in profile.demonstrates" :key="item">{{ item }}</li>
      </ul>
    </section>

    <section>
      <h2>Stack</h2>
      <ul class="tags">
        <li v-for="item in profile.stack" :key="item">{{ item }}</li>
      </ul>
    </section>

    <section>
      <h2>Links</h2>
      <ul>
        <li v-for="link in profile.links" :key="link.href">
          <a :href="link.href">{{ link.label }}</a>
        </li>
      </ul>
    </section>
  </main>
</template>
