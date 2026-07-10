import {
  archiveBean as archiveBeanRecord,
  createBrewWithBeanUpdate,
  deleteBrewWithBeanRestore,
  getBrew,
  listBeans,
  listBrews,
  saveBean,
  updateBrewWithBeanAdjustments
} from '~/utils/storage'
import {
  calculateRatio,
  createId,
  DEFAULT_BEAN_THRESHOLD,
  getDialingInTip,
  isBeanLowStock,
  parseDurationSeconds,
  normalizeTastingNotes,
  normalizeText,
  sortBeans,
  sortBrews
} from '~/utils/domain'
import type { Bean, BeanDraft, Brew, BrewDraft, TopTastingNote } from '~/utils/types'

let hydrationPromise: Promise<void> | null = null

function replaceBean(collection: Bean[], bean: Bean) {
  return sortBeans(collection.map((entry) => (entry.id === bean.id ? bean : entry)))
}

export function useBeanstalk() {
  const beans = useState<Bean[]>('beanstalk:beans', () => [])
  const brews = useState<Brew[]>('beanstalk:brews', () => [])
  const isLoading = useState<boolean>('beanstalk:is-loading', () => false)
  const hasHydrated = useState<boolean>('beanstalk:has-hydrated', () => false)

  async function ensureHydrated() {
    if (!import.meta.client || hasHydrated.value) {
      return
    }

    if (!hydrationPromise) {
      hydrationPromise = (async () => {
        isLoading.value = true

        try {
          const [storedBeans, storedBrews] = await Promise.all([listBeans(), listBrews()])
          beans.value = sortBeans(storedBeans)
          brews.value = sortBrews(storedBrews)
          hasHydrated.value = true
        }
        finally {
          isLoading.value = false
        }
      })()
    }

    await hydrationPromise
  }

  const activeBeans = computed(() => beans.value.filter((bean) => bean.archivedAt === null))
  const archivedBeans = computed(() => beans.value.filter((bean) => bean.archivedAt !== null))
  const selectableBeans = computed(() =>
    activeBeans.value.filter((bean) => bean.remaining > 0)
  )
  const lowStockBeans = computed(() => activeBeans.value.filter(isBeanLowStock))
  const recentBrews = computed(() => sortBrews(brews.value))

  const brewsWithBean = computed(() =>
    recentBrews.value.map((brew) => ({
      brew,
      bean: beans.value.find((bean) => bean.id === brew.beanId) ?? null
    }))
  )

  const topTastingNotes = computed<TopTastingNote[]>(() => {
    const counts = new Map<string, number>()

    for (const brew of brews.value) {
      for (const note of brew.tastingNotes) {
        counts.set(note, (counts.get(note) ?? 0) + 1)
      }
    }

    return Array.from(counts.entries())
      .map(([note, count]) => ({ note, count }))
      .sort((left, right) => right.count - left.count || left.note.localeCompare(right.note))
      .slice(0, 5)
  })

  const latestBrew = computed(() => recentBrews.value[0] ?? null)
  const dialingInTip = computed(() => getDialingInTip(latestBrew.value))

  async function createBean(input: BeanDraft) {
    await ensureHydrated()

    const now = new Date().toISOString()
    const startWeight = Number(input.startWeight)
    const threshold = Number.isFinite(input.threshold) ? Number(input.threshold) : DEFAULT_BEAN_THRESHOLD

    if (startWeight <= 0) {
      throw new Error('Start weight must be greater than 0g.')
    }

    if (threshold < 0) {
      throw new Error('Threshold must be 0g or higher.')
    }

    const bean: Bean = {
      id: createId('bean'),
      name: normalizeText(input.name),
      roaster: normalizeText(input.roaster),
      origin: normalizeText(input.origin),
      region: normalizeText(input.region),
      varietal: normalizeText(input.varietal),
      process: normalizeText(input.process),
      roastProfile: input.roastProfile,
      roastDate: input.roastDate ?? null,
      tastingNotes: normalizeTastingNotes(input.tastingNotes ?? []),
      startWeight,
      remaining: startWeight,
      threshold,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    }

    if (!bean.name || !bean.roaster || !bean.origin || !bean.process) {
      throw new Error('Complete every bean field before saving.')
    }

    await saveBean(bean)
    beans.value = sortBeans([bean, ...beans.value])

    return bean
  }

  async function archiveBean(beanId: string) {
    await ensureHydrated()

    const updatedBean = await archiveBeanRecord(beanId, new Date().toISOString())
    beans.value = replaceBean(beans.value, updatedBean)
    return updatedBean
  }

  function buildBrewRecord(input: BrewDraft, existingBrew?: Brew): Brew {
    const now = new Date().toISOString()
    const dose = Number(input.dose)
    const yieldAmount = Number(input.yield)
    const brewTime = parseDurationSeconds(input.brewTime)

    if (!input.beanId) {
      throw new Error('Select a bean before saving the brew.')
    }

    if (dose <= 0) {
      throw new Error('Dose must be greater than 0g.')
    }

    if (yieldAmount <= 0) {
      throw new Error('Yield must be greater than 0g.')
    }

    if (brewTime < 0) {
      throw new Error('Brew time must be 0 seconds or higher.')
    }

    const tastingNotes = normalizeTastingNotes(input.tastingNotes)

    return {
      id: existingBrew?.id ?? createId('brew'),
      beanId: input.beanId,
      brewedAt: input.brewedAt,
      method: input.method,
      grinder: normalizeText(input.grinder),
      dose,
      yield: yieldAmount,
      brewTime,
      pours: normalizeText(input.pours),
      tastingNotes,
      ratio: calculateRatio(dose, yieldAmount),
      createdAt: existingBrew?.createdAt ?? now,
      updatedAt: now
    }
  }

  async function createBrew(input: BrewDraft) {
    await ensureHydrated()

    const brew = buildBrewRecord(input)
    const result = await createBrewWithBeanUpdate(brew)

    beans.value = replaceBean(beans.value, result.bean)
    brews.value = sortBrews([result.brew, ...brews.value.filter((entry) => entry.id !== result.brew.id)])

    return result.brew
  }

  async function updateBrew(brewId: string, input: BrewDraft) {
    await ensureHydrated()

    const existingBrew = await getBrew(brewId)

    if (!existingBrew) {
      throw new Error('Brew not found.')
    }

    const updatedBrew = buildBrewRecord(input, existingBrew)
    const result = await updateBrewWithBeanAdjustments(updatedBrew)

    let nextBeans = beans.value

    for (const updatedBean of result.updatedBeans) {
      const existingBean = nextBeans.find((bean) => bean.id === updatedBean.id)

      if (existingBean) {
        nextBeans = replaceBean(nextBeans, updatedBean)
      }
      else {
        nextBeans = sortBeans([updatedBean, ...nextBeans])
      }
    }

    beans.value = nextBeans
    brews.value = sortBrews(
      brews.value.map((brew) => (brew.id === result.brew.id ? result.brew : brew))
    )

    return result.brew
  }

  async function deleteBrew(brewId: string) {
    await ensureHydrated()

    const result = await deleteBrewWithBeanRestore(brewId)
    beans.value = replaceBean(beans.value, result.bean)
    brews.value = brews.value.filter((brew) => brew.id !== brewId)
  }

  function getBeanById(beanId: string) {
    return beans.value.find((bean) => bean.id === beanId) ?? null
  }

  async function findStoredBrew(brewId: string) {
    await ensureHydrated()
    return getBrew(brewId)
  }

  return {
    beans,
    brews,
    isLoading,
    hasHydrated,
    activeBeans,
    archivedBeans,
    selectableBeans,
    lowStockBeans,
    recentBrews,
    brewsWithBean,
    topTastingNotes,
    latestBrew,
    dialingInTip,
    ensureHydrated,
    createBean,
    archiveBean,
    createBrew,
    updateBrew,
    deleteBrew,
    getBeanById,
    findStoredBrew
  }
}
