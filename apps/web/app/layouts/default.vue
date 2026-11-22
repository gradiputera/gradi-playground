<template>
  <div class="shell">
    <header class="site-header">
      <NuxtLink to="/" class="brand">gradi-playground</NuxtLink>
      <nav>
        <NuxtLink to="/playground">Playground</NuxtLink>
      </nav>
    </header>
    <slot />
    <footer class="site-footer">
      <a href="https://github.com/gradiputera/gradi-playground">Source code</a>
      <span>MIT License</span>
    </footer>
  </div>
</template>
