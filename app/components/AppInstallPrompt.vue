<script setup lang="ts">
import { Download, WifiOff } from '@lucide/vue'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean
}

type InstallPromptMode = 'native' | 'ios-safari' | 'ios-other' | null

const installEvent = ref<BeforeInstallPromptEvent | null>(null)
const isOffline = ref(false)
const isInstalled = ref(false)
const installPromptMode = ref<InstallPromptMode>(null)
const showIosSteps = ref(false)

let standaloneMediaQuery: MediaQueryList | null = null

const shouldShowBanner = computed(() => isOffline.value || (!isInstalled.value && installPromptMode.value !== null))
const shouldShowInstallButton = computed(
  () => !isOffline.value && (installPromptMode.value === 'native' || installPromptMode.value === 'ios-safari'),
)
const installButtonLabel = computed(() => (installPromptMode.value === 'native' ? 'Install' : 'Show steps'))
const showExpandedIosSteps = computed(
  () => !isOffline.value && installPromptMode.value === 'ios-safari' && showIosSteps.value,
)
const installDescription = computed(() => {
  if (isOffline.value) {
    return 'Your local stash and brew journal are still available from on-device storage.'
  }

  if (installPromptMode.value === 'native') {
    return 'Add the app to your device for faster offline access to your stash, journal, and insights.'
  }

  if (installPromptMode.value === 'ios-safari') {
    return 'Add BeanStalk to your home screen in Safari for faster offline access to your stash, journal, and insights.'
  }

  if (installPromptMode.value === 'ios-other') {
    return 'To install on iPhone or iPad, open BeanStalk in Safari and choose Add to Home Screen.'
  }

  return ''
})

function isRunningStandalone() {
  const navigatorWithStandalone = window.navigator as NavigatorWithStandalone

  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true
}

function detectInstallPromptMode(): InstallPromptMode {
  if (installEvent.value) {
    return 'native'
  }

  const userAgent = window.navigator.userAgent
  const isIosDevice =
    /iPad|iPhone|iPod/.test(userAgent)
    || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
  const isSafariBrowser = /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)

  if (isIosDevice && isSafariBrowser) {
    return 'ios-safari'
  }

  if (isIosDevice) {
    return 'ios-other'
  }

  return null
}

function syncInstallAvailability() {
  isInstalled.value = isRunningStandalone()
  installPromptMode.value = isInstalled.value ? null : detectInstallPromptMode()

  if (installPromptMode.value !== 'ios-safari') {
    showIosSteps.value = false
  }
}

function updateOnlineStatus() {
  isOffline.value = !navigator.onLine
}

async function installApp() {
  if (installPromptMode.value === 'ios-safari') {
    showIosSteps.value = !showIosSteps.value
    return
  }

  if (!installEvent.value) {
    return
  }

  await installEvent.value.prompt()
  await installEvent.value.userChoice
  installEvent.value = null
  syncInstallAvailability()
}

function handleBeforeInstallPrompt(event: Event) {
  event.preventDefault()
  installEvent.value = event as BeforeInstallPromptEvent
  syncInstallAvailability()
}

function handleAppInstalled() {
  installEvent.value = null
  syncInstallAvailability()
}

function handleStandaloneChange() {
  syncInstallAvailability()
}

onMounted(() => {
  updateOnlineStatus()
  standaloneMediaQuery = window.matchMedia('(display-mode: standalone)')
  syncInstallAvailability()

  window.addEventListener('online', updateOnlineStatus)
  window.addEventListener('offline', updateOnlineStatus)
  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  window.addEventListener('appinstalled', handleAppInstalled)
  standaloneMediaQuery.addEventListener('change', handleStandaloneChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('online', updateOnlineStatus)
  window.removeEventListener('offline', updateOnlineStatus)
  window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  window.removeEventListener('appinstalled', handleAppInstalled)
  standaloneMediaQuery?.removeEventListener('change', handleStandaloneChange)
})
</script>

<template>
  <div
    v-if="shouldShowBanner"
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
          {{ installDescription }}
        </p>
        <p
          v-if="showExpandedIosSteps"
          class="mt-2 text-xs leading-5 text-espresso-700"
        >
          Tap the Share button in Safari, then choose <strong>Add to Home Screen</strong>.
        </p>
      </div>
    </div>

    <button
      v-if="shouldShowInstallButton"
      type="button"
      class="secondary-button shrink-0"
      @click="installApp"
    >
      {{ installButtonLabel }}
    </button>
  </div>
</template>
