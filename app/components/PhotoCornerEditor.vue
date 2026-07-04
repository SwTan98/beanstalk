<script setup lang="ts">
import type { Corners, Point } from '~/utils/opencv-perspective'

const props = defineProps<{
  imageUrl: string
  imageWidth: number
  imageHeight: number
  corners: Corners
}>()

const emit = defineEmits<{
  'update:corners': [Corners]
  confirm: []
  cancel: []
}>()

const svgRef = ref<SVGSVGElement | null>(null)
const draggingIndex = ref<number | null>(null)

const handleRadius = computed(() => Math.max(props.imageWidth, props.imageHeight) * 0.025)
const strokeWidth = computed(() => Math.max(props.imageWidth, props.imageHeight) * 0.006)
const polygonPoints = computed(() => props.corners.map((point) => `${point.x},${point.y}`).join(' '))

function toImageSpacePoint(event: PointerEvent): Point | null {
  const svg = svgRef.value
  const ctm = svg?.getScreenCTM()

  if (!svg || !ctm) {
    return null
  }

  const svgPoint = svg.createSVGPoint()
  svgPoint.x = event.clientX
  svgPoint.y = event.clientY
  const transformed = svgPoint.matrixTransform(ctm.inverse())

  return {
    x: Math.min(Math.max(transformed.x, 0), props.imageWidth),
    y: Math.min(Math.max(transformed.y, 0), props.imageHeight)
  }
}

function onHandlePointerDown(index: number, event: PointerEvent) {
  draggingIndex.value = index
  ;(event.target as Element).setPointerCapture(event.pointerId)
}

function onSvgPointerMove(event: PointerEvent) {
  if (draggingIndex.value === null) {
    return
  }

  const point = toImageSpacePoint(event)

  if (!point) {
    return
  }

  const next = [...props.corners] as Corners
  next[draggingIndex.value] = point
  emit('update:corners', next)
}

function onPointerUp() {
  draggingIndex.value = null
}
</script>

<template>
  <div class="space-y-3">
    <div class="relative overflow-hidden rounded-2xl border border-espresso-200 bg-black/5">
      <img
        :src="imageUrl"
        :width="imageWidth"
        :height="imageHeight"
        class="block h-auto w-full select-none"
        draggable="false"
        alt="Captured bag photo"
      >
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${imageWidth} ${imageHeight}`"
        class="absolute inset-0 h-full w-full touch-none"
        @pointermove="onSvgPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <polygon
          :points="polygonPoints"
          fill="rgba(59, 130, 246, 0.15)"
          stroke="#3b82f6"
          :stroke-width="strokeWidth"
        />
        <circle
          v-for="(point, index) in corners"
          :key="index"
          :cx="point.x"
          :cy="point.y"
          :r="handleRadius"
          fill="#3b82f6"
          stroke="white"
          :stroke-width="strokeWidth"
          class="cursor-grab"
          @pointerdown="onHandlePointerDown(index, $event)"
        />
      </svg>
    </div>

    <p class="field-help">
      Drag the corners so they match the bag or label edges.
    </p>

    <div class="flex gap-2">
      <button type="button" class="secondary-button flex-1" @click="emit('cancel')">
        Retake
      </button>
      <button type="button" class="primary-button flex-1" @click="emit('confirm')">
        Use this crop
      </button>
    </div>
  </div>
</template>
