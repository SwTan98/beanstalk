import type { IDBPDatabase } from 'idb'
import type { BeanstalkDatabase } from '~/utils/storage-schema'

export interface DatabaseUpgradeStep {
  version: number
  description: string
  apply: (database: IDBPDatabase<BeanstalkDatabase>) => void
}

export const BEANSTALK_DATABASE_UPGRADE_STEPS: DatabaseUpgradeStep[] = [
  {
    version: 1,
    description: 'Create bean and brew stores with indexes.',
    apply(database) {
      if (!database.objectStoreNames.contains('beans')) {
        const beanStore = database.createObjectStore('beans', {
          keyPath: 'id'
        })
        beanStore.createIndex('by-updated-at', 'updatedAt')
        beanStore.createIndex('by-archived-at', 'archivedAt')
      }

      if (!database.objectStoreNames.contains('brews')) {
        const brewStore = database.createObjectStore('brews', {
          keyPath: 'id'
        })
        brewStore.createIndex('by-brewed-at', 'brewedAt')
        brewStore.createIndex('by-bean-id', 'beanId')
      }
    }
  },
  {
    version: 2,
    description: 'Create metadata store for persisted schema versioning.',
    apply(database) {
      if (!database.objectStoreNames.contains('meta')) {
        database.createObjectStore('meta', {
          keyPath: 'key'
        })
      }
    }
  },
  {
    version: 4,
    description: 'Remove orphaned beanPhotos store left by a reverted feature.',
    apply(database) {
      if (database.objectStoreNames.contains('beanPhotos')) {
        database.deleteObjectStore('beanPhotos')
      }
    }
  },
  {
    version: 5,
    description: 'Create grinders store for managed grinder equipment.',
    apply(database) {
      if (!database.objectStoreNames.contains('grinders')) {
        database.createObjectStore('grinders', {
          keyPath: 'id'
        })
      }
    }
  }
]

export function applyDatabaseUpgradeSteps(
  database: IDBPDatabase<BeanstalkDatabase>,
  oldVersion: number,
  steps: DatabaseUpgradeStep[] = BEANSTALK_DATABASE_UPGRADE_STEPS
) {
  const orderedSteps = [...steps].sort((left, right) => left.version - right.version)

  for (const step of orderedSteps) {
    if (oldVersion < step.version) {
      step.apply(database)
    }
  }
}
