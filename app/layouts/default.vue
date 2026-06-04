<template>
  <div class="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.9),_rgba(247,240,229,1))]">
    <div class="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-28 pt-6">
      <AppInstallPrompt />
      <main class="flex-1">
        <slot />
      </main>
    </div>

    <AppBottomNav />
  </div>
</template>
