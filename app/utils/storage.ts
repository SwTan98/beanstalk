import type { DBSchema, IDBPDatabase } from 'idb'
import { normalizeText, parseDurationSeconds } from '~/utils/domain'
import type { Bean, Brew } from '~/utils/types'

interface BeanstalkDatabase extends DBSchema {
  beans: {
    key: string
    value: Bean
    indexes: {
      'by-updated-at': string
      'by-archived-at': string | null
    }
  }
  brews: {
    key: string
    value: Brew
    indexes: {
      'by-brewed-at': string
      'by-bean-id': string
    }
  }
}

const DATABASE_NAME = 'beanstalk'
const DATABASE_VERSION = 1

let databasePromise: Promise<IDBPDatabase<BeanstalkDatabase>> | null = null

function normalizeBrew(brew: Brew): Brew {
  return {
    ...brew,
    brewTime: parseDurationSeconds(brew.brewTime)
  }
}

function normalizeBean(bean: Bean): Bean {
  return {
    ...bean,
    region: normalizeText(bean.region),
    varietal: normalizeText(bean.varietal)
  }
}

async function getDatabase() {
  if (!import.meta.client) {
    throw new Error('IndexedDB is only available in the browser.')
  }

  if (!databasePromise) {
    databasePromise = import('idb').then(({ openDB }) =>
      openDB<BeanstalkDatabase>(DATABASE_NAME, DATABASE_VERSION, {
        upgrade(database) {
          const beanStore = database.createObjectStore('beans', {
            keyPath: 'id'
          })
          beanStore.createIndex('by-updated-at', 'updatedAt')
          beanStore.createIndex('by-archived-at', 'archivedAt')

          const brewStore = database.createObjectStore('brews', {
            keyPath: 'id'
          })
          brewStore.createIndex('by-brewed-at', 'brewedAt')
          brewStore.createIndex('by-bean-id', 'beanId')
        }
      })
    )
  }

  return databasePromise
}

export async function listBeans() {
  const database = await getDatabase()
  return (await database.getAll('beans')).map(normalizeBean)
}

export async function getBean(beanId: string) {
  const database = await getDatabase()
  const bean = await database.get('beans', beanId)
  return bean ? normalizeBean(bean) : bean
}

export async function saveBean(bean: Bean) {
  const database = await getDatabase()
  const transaction = database.transaction('beans', 'readwrite')
  await transaction.store.put(normalizeBean(bean))
  await transaction.done
  return normalizeBean(bean)
}

export async function archiveBean(beanId: string, archivedAt: string) {
  const database = await getDatabase()
  const transaction = database.transaction('beans', 'readwrite')
  const bean = await transaction.store.get(beanId)

  if (!bean) {
    throw new Error('Bean not found.')
  }

  const updatedBean: Bean = {
    ...normalizeBean(bean),
    archivedAt,
    updatedAt: archivedAt
  }

  await transaction.store.put(updatedBean)
  await transaction.done
  return updatedBean
}

export async function listBrews() {
  const database = await getDatabase()
  return (await database.getAll('brews')).map(normalizeBrew)
}

export async function getBrew(brewId: string) {
  const database = await getDatabase()
  const brew = await database.get('brews', brewId)
  return brew ? normalizeBrew(brew) : brew
}

export async function createBrewWithBeanUpdate(brew: Brew) {
  const database = await getDatabase()
  const transaction = database.transaction(['beans', 'brews'], 'readwrite')
  const beanStore = transaction.objectStore('beans')
  const brewStore = transaction.objectStore('brews')
  const bean = await beanStore.get(brew.beanId)

  if (!bean) {
    throw new Error('Selected bean could not be found.')
  }

  if (bean.archivedAt) {
    throw new Error('Archived beans cannot be used for new brews.')
  }

  if (brew.dose > bean.remaining) {
    throw new Error('Dose cannot exceed the selected bean remaining weight.')
  }

  const updatedBean: Bean = {
    ...normalizeBean(bean),
    remaining: bean.remaining - brew.dose,
    updatedAt: brew.updatedAt
  }

  await beanStore.put(updatedBean)
  await brewStore.put(normalizeBrew(brew))
  await transaction.done

  return {
    bean: updatedBean,
    brew
  }
}

export async function updateBrewWithBeanAdjustments(updatedBrew: Brew) {
  const database = await getDatabase()
  const transaction = database.transaction(['beans', 'brews'], 'readwrite')
  const beanStore = transaction.objectStore('beans')
  const brewStore = transaction.objectStore('brews')
  const existingBrew = await brewStore.get(updatedBrew.id)

  if (!existingBrew) {
    throw new Error('Brew not found.')
  }

  const previousBean = await beanStore.get(existingBrew.beanId)
  const nextBean = await beanStore.get(updatedBrew.beanId)

  if (!previousBean || !nextBean) {
    throw new Error('Bean data for this brew is missing.')
  }

  if (nextBean.archivedAt && existingBrew.beanId !== updatedBrew.beanId) {
    throw new Error('Archived beans cannot be used for new brews.')
  }

  if (existingBrew.beanId === updatedBrew.beanId) {
    const available = nextBean.remaining + existingBrew.dose

    if (updatedBrew.dose > available) {
      throw new Error('Dose cannot exceed the selected bean remaining weight.')
    }

    const updatedBean: Bean = {
      ...normalizeBean(nextBean),
      remaining: available - updatedBrew.dose,
      updatedAt: updatedBrew.updatedAt
    }

    await beanStore.put(updatedBean)
    await brewStore.put(normalizeBrew(updatedBrew))
    await transaction.done

    return {
      updatedBeans: [updatedBean],
      brew: updatedBrew
    }
  }

  const restoredPreviousBean: Bean = {
    ...normalizeBean(previousBean),
    remaining: previousBean.remaining + existingBrew.dose,
    updatedAt: updatedBrew.updatedAt
  }

  if (updatedBrew.dose > nextBean.remaining) {
    throw new Error('Dose cannot exceed the selected bean remaining weight.')
  }

  const updatedNextBean: Bean = {
    ...normalizeBean(nextBean),
    remaining: nextBean.remaining - updatedBrew.dose,
    updatedAt: updatedBrew.updatedAt
  }

  await beanStore.put(restoredPreviousBean)
  await beanStore.put(updatedNextBean)
  await brewStore.put(normalizeBrew(updatedBrew))
  await transaction.done

  return {
    updatedBeans: [restoredPreviousBean, updatedNextBean],
    brew: updatedBrew
  }
}

export async function deleteBrewWithBeanRestore(brewId: string) {
  const database = await getDatabase()
  const transaction = database.transaction(['beans', 'brews'], 'readwrite')
  const beanStore = transaction.objectStore('beans')
  const brewStore = transaction.objectStore('brews')
  const brew = await brewStore.get(brewId)

  if (!brew) {
    throw new Error('Brew not found.')
  }

  const bean = await beanStore.get(brew.beanId)

  if (!bean) {
    throw new Error('Linked bean could not be found.')
  }

  const updatedBean: Bean = {
    ...normalizeBean(bean),
    remaining: Math.min(bean.startWeight, bean.remaining + brew.dose),
    updatedAt: new Date().toISOString()
  }

  await beanStore.put(updatedBean)
  await brewStore.delete(brewId)
  await transaction.done

  return {
    bean: updatedBean,
    brewId
  }
}
