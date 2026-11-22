<script setup lang="ts">
definePageMeta({ layout: 'playground' })
useHead({ title: 'Playground · gradi-playground' })
</script>

<template>
  <main class="page">
    <h1>Playground</h1>
    <p>Try the system end to end. Choose a destination.</p>
    <div class="cards">
      <NuxtLink to="/playground/payment" class="card">
        <strong>Payment</strong>
        Simulate a payment and follow it through the services, the ledger and the event bus.
      </NuxtLink>
      <NuxtLink to="/playground/dashboards" class="card">
        <strong>Dashboards</strong>
        Request rates, errors, latency and logs for every service.
      </NuxtLink>
    </div>
  </main>
</template>
