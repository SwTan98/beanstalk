import type { IDBPDatabase } from 'idb'
import {
  createId,
  normalizeTastingNotes,
  normalizeText,
  parseDurationSeconds,
  roundToSingleDecimal,
  withAdjustedRemaining
} from '~/utils/domain'
import type { Bean, Brew, Grinder } from '~/utils/types'
import {
  DATABASE_NAME,
  DATABASE_VERSION,
  SCHEMA_VERSION_KEY,
  STORAGE_SCHEMA_VERSION,
  type BeanstalkDatabase,
  type StoredBean,
  type StoredBrew
} from '~/utils/storage-schema'
import { applyDatabaseUpgradeSteps } from '~/utils/storage-upgrades'

let databasePromise: Promise<IDBPDatabase<BeanstalkDatabase>> | null = null

function brewFromStorage(brew: StoredBrew): Brew {
  return {
    ...brew,
    brewTime: parseDurationSeconds(brew.brewTime)
  }
}

function brewToStorage(brew: Brew): StoredBrew {
  return {
    ...brew,
    brewTime: parseDurationSeconds(brew.brewTime)
  }
}

function beanFromStorage(bean: StoredBean): Bean {
  return {
    ...bean,
    region: normalizeText(bean.region),
    varietal: normalizeText(bean.varietal),
    roastDate: typeof bean.roastDate === 'string' && bean.roastDate ? bean.roastDate : null,
    tastingNotes: normalizeTastingNotes(Array.isArray(bean.tastingNotes) ? bean.tastingNotes : [])
  }
}

function beanToStorage(bean: Bean): StoredBean {
  return {
    ...bean,
    region: normalizeText(bean.region),
    varietal: normalizeText(bean.varietal),
    roastDate: bean.roastDate,
    tastingNotes: normalizeTastingNotes(bean.tastingNotes)
  }
}

async function migrateToSchemaVersion1(database: IDBPDatabase<BeanstalkDatabase>) {
  const transaction = database.transaction(['beans', 'brews', 'meta'], 'readwrite')
  const beanStore = transaction.objectStore('beans')
  const brewStore = transaction.objectStore('brews')
  const metaStore = transaction.objectStore('meta')
  const storedBeans = await beanStore.getAll()
  const storedBrews = await brewStore.getAll()

  for (const storedBean of storedBeans) {
    await beanStore.put(beanToStorage(beanFromStorage(storedBean)))
  }

  for (const storedBrew of storedBrews) {
    await brewStore.put(brewToStorage(brewFromStorage(storedBrew)))
  }

  // Each migration records its own version literal so an interrupted chain
  // resumes from the right step rather than skipping ahead.
  await metaStore.put({
    key: SCHEMA_VERSION_KEY,
    value: 1
  })
  await transaction.done
}

// Schema version 2: beans gained roastDate/tastingNotes. Rewriting each bean
// through beanFromStorage/beanToStorage defaults old records to null/[].
async function migrateToSchemaVersion2(database: IDBPDatabase<BeanstalkDatabase>) {
  const transaction = database.transaction(['beans', 'meta'], 'readwrite')
  const beanStore = transaction.objectStore('beans')
  const metaStore = transaction.objectStore('meta')
  const storedBeans = await beanStore.getAll()

  for (const storedBean of storedBeans) {
    await beanStore.put(beanToStorage(beanFromStorage(storedBean)))
  }

  await metaStore.put({
    key: SCHEMA_VERSION_KEY,
    value: 2
  })
  await transaction.done
}

// Schema version 3: seed the grinders store from distinct grinder names used
// in historical brews, deduped case-insensitively with the most recent brew's
// casing winning.
async function migrateToSchemaVersion3(database: IDBPDatabase<BeanstalkDatabase>) {
  const transaction = database.transaction(['brews', 'grinders', 'meta'], 'readwrite')
  const brewStore = transaction.objectStore('brews')
  const grinderStore = transaction.objectStore('grinders')
  const metaStore = transaction.objectStore('meta')
  const storedBrews = await brewStore.getAll()
  const now = new Date().toISOString()

  const sortedBrews = storedBrews
    .map(brewFromStorage)
    .sort((left, right) => right.brewedAt.localeCompare(left.brewedAt))
  const namesByKey = new Map<string, string>()

  for (const brew of sortedBrews) {
    const name = normalizeText(brew.grinder)
    const key = name.toLowerCase()

    if (name && !namesByKey.has(key)) {
      namesByKey.set(key, name)
    }
  }

  for (const name of namesByKey.values()) {
    await grinderStore.put({
      id: createId('grinder'),
      name,
      createdAt: now,
      updatedAt: now
    })
  }

  await metaStore.put({
    key: SCHEMA_VERSION_KEY,
    value: 3
  })
  await transaction.done
}

// Schema version 4: beans depleted to 0g now auto-archive; archive existing
// depleted beans so old data matches the new rule.
async function migrateToSchemaVersion4(database: IDBPDatabase<BeanstalkDatabase>) {
  const transaction = database.transaction(['beans', 'meta'], 'readwrite')
  const beanStore = transaction.objectStore('beans')
  const metaStore = transaction.objectStore('meta')
  const storedBeans = await beanStore.getAll()

  for (const storedBean of storedBeans) {
    const bean = beanFromStorage(storedBean)

    if (bean.archivedAt === null && roundToSingleDecimal(bean.remaining) <= 0) {
      await beanStore.put(beanToStorage({
        ...bean,
        archivedAt: bean.updatedAt
      }))
    }
  }

  await metaStore.put({
    key: SCHEMA_VERSION_KEY,
    value: 4
  })
  await transaction.done
}

async function ensureSchemaCompatibility(database: IDBPDatabase<BeanstalkDatabase>) {
  const schemaVersion = await database.get('meta', SCHEMA_VERSION_KEY)
  const persistedVersion = schemaVersion?.value ?? 0

  if (persistedVersion >= STORAGE_SCHEMA_VERSION) {
    return
  }

  if (persistedVersion < 1) {
    await migrateToSchemaVersion1(database)
  }

  if (persistedVersion < 2) {
    await migrateToSchemaVersion2(database)
  }

  if (persistedVersion < 3) {
    await migrateToSchemaVersion3(database)
  }

  if (persistedVersion < 4) {
    await migrateToSchemaVersion4(database)
  }
}

async function getDatabase() {
  if (!import.meta.client) {
    throw new Error('IndexedDB is only available in the browser.')
  }

  if (!databasePromise) {
    databasePromise = import('idb').then(async ({ openDB }) => {
      const database = await openDB<BeanstalkDatabase>(DATABASE_NAME, DATABASE_VERSION, {
        upgrade(upgradingDatabase, oldVersion) {
          applyDatabaseUpgradeSteps(upgradingDatabase, oldVersion)
        }
      })

      await ensureSchemaCompatibility(database)
      return database
    })
  }

  return databasePromise
}

export async function listBeans() {
  const database = await getDatabase()
  return (await database.getAll('beans')).map(beanFromStorage)
}

export async function getBean(beanId: string) {
  const database = await getDatabase()
  const bean = await database.get('beans', beanId)
  return bean ? beanFromStorage(bean) : bean
}

export async function saveBean(bean: Bean) {
  const database = await getDatabase()
  const transaction = database.transaction('beans', 'readwrite')
  const storedBean = beanToStorage(bean)
  await transaction.store.put(storedBean)
  await transaction.done
  return beanFromStorage(storedBean)
}

export async function archiveBean(beanId: string, archivedAt: string) {
  const database = await getDatabase()
  const transaction = database.transaction('beans', 'readwrite')
  const storedBean = await transaction.store.get(beanId)

  if (!storedBean) {
    throw new Error('Bean not found.')
  }

  const bean = beanFromStorage(storedBean)
  const updatedBean: Bean = {
    ...bean,
    archivedAt,
    updatedAt: archivedAt
  }

  await transaction.store.put(beanToStorage(updatedBean))
  await transaction.done
  return updatedBean
}

export async function listGrinders() {
  const database = await getDatabase()
  return database.getAll('grinders')
}

export async function saveGrinder(grinder: Grinder) {
  const database = await getDatabase()
  const transaction = database.transaction('grinders', 'readwrite')
  await transaction.store.put(grinder)
  await transaction.done
  return grinder
}

export async function deleteGrinder(grinderId: string) {
  const database = await getDatabase()
  const transaction = database.transaction('grinders', 'readwrite')
  await transaction.store.delete(grinderId)
  await transaction.done
}

export async function listBrews() {
  const database = await getDatabase()
  return (await database.getAll('brews')).map(brewFromStorage)
}

export async function getBrew(brewId: string) {
  const database = await getDatabase()
  const brew = await database.get('brews', brewId)
  return brew ? brewFromStorage(brew) : brew
}

export async function createBrewWithBeanUpdate(brew: Brew) {
  const database = await getDatabase()
  const transaction = database.transaction(['beans', 'brews'], 'readwrite')
  const beanStore = transaction.objectStore('beans')
  const brewStore = transaction.objectStore('brews')
  const storedBean = await beanStore.get(brew.beanId)

  if (!storedBean) {
    throw new Error('Selected bean could not be found.')
  }

  const bean = beanFromStorage(storedBean)

  if (bean.archivedAt) {
    throw new Error('Archived beans cannot be used for new brews.')
  }

  if (brew.dose > bean.remaining) {
    throw new Error('Dose cannot exceed the selected bean remaining weight.')
  }

  const updatedBean = withAdjustedRemaining(bean, bean.remaining - brew.dose, brew.updatedAt)
  const normalizedBrew = brewFromStorage(brewToStorage(brew))

  await beanStore.put(beanToStorage(updatedBean))
  await brewStore.put(brewToStorage(normalizedBrew))
  await transaction.done

  return {
    bean: updatedBean,
    brew: normalizedBrew
  }
}

export async function updateBrewWithBeanAdjustments(updatedBrew: Brew) {
  const database = await getDatabase()
  const transaction = database.transaction(['beans', 'brews'], 'readwrite')
  const beanStore = transaction.objectStore('beans')
  const brewStore = transaction.objectStore('brews')
  const storedExistingBrew = await brewStore.get(updatedBrew.id)

  if (!storedExistingBrew) {
    throw new Error('Brew not found.')
  }

  const existingBrew = brewFromStorage(storedExistingBrew)
  const storedPreviousBean = await beanStore.get(existingBrew.beanId)
  const storedNextBean = await beanStore.get(updatedBrew.beanId)

  if (!storedPreviousBean || !storedNextBean) {
    throw new Error('Bean data for this brew is missing.')
  }

  const previousBean = beanFromStorage(storedPreviousBean)
  const nextBean = beanFromStorage(storedNextBean)
  const normalizedUpdatedBrew = brewFromStorage(brewToStorage(updatedBrew))

  if (nextBean.archivedAt && existingBrew.beanId !== updatedBrew.beanId) {
    throw new Error('Archived beans cannot be used for new brews.')
  }

  if (existingBrew.beanId === updatedBrew.beanId) {
    const available = nextBean.remaining + existingBrew.dose

    if (updatedBrew.dose > available) {
      throw new Error('Dose cannot exceed the selected bean remaining weight.')
    }

    const updatedBean = withAdjustedRemaining(nextBean, available - updatedBrew.dose, updatedBrew.updatedAt)

    await beanStore.put(beanToStorage(updatedBean))
    await brewStore.put(brewToStorage(normalizedUpdatedBrew))
    await transaction.done

    return {
      updatedBeans: [updatedBean],
      brew: normalizedUpdatedBrew
    }
  }

  const restoredPreviousBean = withAdjustedRemaining(
    previousBean,
    previousBean.remaining + existingBrew.dose,
    updatedBrew.updatedAt
  )

  if (updatedBrew.dose > nextBean.remaining) {
    throw new Error('Dose cannot exceed the selected bean remaining weight.')
  }

  const updatedNextBean = withAdjustedRemaining(
    nextBean,
    nextBean.remaining - updatedBrew.dose,
    updatedBrew.updatedAt
  )

  await beanStore.put(beanToStorage(restoredPreviousBean))
  await beanStore.put(beanToStorage(updatedNextBean))
  await brewStore.put(brewToStorage(normalizedUpdatedBrew))
  await transaction.done

  return {
    updatedBeans: [restoredPreviousBean, updatedNextBean],
    brew: normalizedUpdatedBrew
  }
}

export async function deleteBrewWithBeanRestore(brewId: string) {
  const database = await getDatabase()
  const transaction = database.transaction(['beans', 'brews'], 'readwrite')
  const beanStore = transaction.objectStore('beans')
  const brewStore = transaction.objectStore('brews')
  const storedBrew = await brewStore.get(brewId)

  if (!storedBrew) {
    throw new Error('Brew not found.')
  }

  const brew = brewFromStorage(storedBrew)
  const bean = await beanStore.get(brew.beanId)

  if (!bean) {
    throw new Error('Linked bean could not be found.')
  }

  const normalizedBean = beanFromStorage(bean)
  const updatedBean = withAdjustedRemaining(
    normalizedBean,
    Math.min(normalizedBean.startWeight, normalizedBean.remaining + brew.dose),
    new Date().toISOString()
  )

  await beanStore.put(beanToStorage(updatedBean))
  await brewStore.delete(brewId)
  await transaction.done

  return {
    bean: updatedBean,
    brewId
  }
}
