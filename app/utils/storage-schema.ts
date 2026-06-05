import type { DBSchema } from 'idb'
import type { Bean, Brew } from '~/utils/types'

export interface StoredBean extends Omit<Bean, 'region' | 'varietal'> {
  region: unknown
  varietal: unknown
}

export interface StoredBrew extends Omit<Brew, 'brewTime'> {
  brewTime: unknown
}

export interface StorageMetadataRecord {
  key: string
  value: number
}

export interface BeanstalkDatabase extends DBSchema {
  beans: {
    key: string
    value: StoredBean
    indexes: {
      'by-updated-at': string
      'by-archived-at': string | null
    }
  }
  brews: {
    key: string
    value: StoredBrew
    indexes: {
      'by-brewed-at': string
      'by-bean-id': string
    }
  }
  meta: {
    key: string
    value: StorageMetadataRecord
  }
}

export const DATABASE_NAME = 'beanstalk'
export const DATABASE_VERSION = 2
export const STORAGE_SCHEMA_VERSION = 1
export const SCHEMA_VERSION_KEY = 'schema-version'
