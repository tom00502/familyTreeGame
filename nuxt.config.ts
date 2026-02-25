// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  srcDir: '.',
  dir: {
    app: 'app',
    pages: 'pages',
    components: 'components',
    composables: 'composables',
  },
  css: [
    '~/assets/css/tailwind.css',
    '@vue-flow/core/dist/style.css',
    '@vue-flow/core/dist/theme-default.css',
    '@vue-flow/controls/dist/style.css',
  ],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  nitro: {
    experimental: {
      websocket: true
    }
  },

  modules: ['@nuxtjs/tailwindcss']
})