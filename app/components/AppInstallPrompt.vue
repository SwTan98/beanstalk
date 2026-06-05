<script setup lang="ts">
import { Download, WifiOff } from '@lucide/vue'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const installEvent = ref<BeforeInstallPromptEvent | null>(null)
const isOffline = ref(false)
const isInstalled = ref(false)

function updateOnlineStatus() {
  isOffline.value = !navigator.onLine
}

async function installApp() {
  if (!installEvent.value) {
    return
  }

  await installEvent.value.prompt()
  await installEvent.value.userChoice
  installEvent.value = null
}

onMounted(() => {
  updateOnlineStatus()
  isInstalled.value = window.matchMedia('(display-mode: standalone)').matches

  window.addEventListener('online', updateOnlineStatus)
  window.addEventListener('offline', updateOnlineStatus)
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installEvent.value = event as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    isInstalled.value = true
    installEvent.value = null
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('online', updateOnlineStatus)
  window.removeEventListener('offline', updateOnlineStatus)
})
</script>

<template>
  <div
    v-if="isOffline || (!!installEvent && !isInstalled)"
    class="surface-card mb-5 flex items-start justify-between gap-4 px-4 py-3"
  >
    <div class="flex items-start gap-3">
      <div
        class="mt-0.5 rounded-2xl p-2"
        :class="isOffline ? 'bg-coral-100 text-coral-500' : 'bg-espresso-100 text-espresso-800'"
      >
        <WifiOff v-if="isOffline" class="h-4 w-4" />
        <Download v-else class="h-4 w-4" />
      </div>

      <div>
        <p class="text-sm font-semibold text-espresso-900">
          {{ isOffline ? 'Offline mode is active' : 'Install BeanStalk' }}
        </p>
        <p class="mt-1 text-xs leading-5 text-espresso-700">
          {{
            isOffline
              ? 'Your local stash and brew journal are still available from on-device storage.'
              : 'Add the app to your home screen for faster offline access to your stash, journal, and insights.'
          }}
        </p>
      </div>
    </div>

    <button
      v-if="installEvent && !isInstalled"
      type="button"
      class="secondary-button shrink-0"
      @click="installApp"
    >
      Install
    </button>
  </div>
</template>
