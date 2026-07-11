import type { DBSchema } from 'idb'
import type { Bean, Brew } from '~/utils/types'

export interface StoredBean extends Omit<Bean, 'region' | 'varietal' | 'roastDate' | 'tastingNotes'> {
  region: unknown
  varietal: unknown
  // Absent (undefined) on records written before schema version 2.
  roastDate: unknown
  tastingNotes: unknown
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
// DATABASE_VERSION guards IndexedDB *structure* (stores/indexes) and only
// moves when storage-upgrades.ts gains a step; STORAGE_SCHEMA_VERSION tracks
// *data-level* migrations run by ensureSchemaCompatibility in storage.ts.
// Schema version 2 added Bean.roastDate/tastingNotes - new properties only,
// so the database version stayed put.
// This must never be decreased, even when reverting a feature that bumped
// it: IndexedDB rejects opening a database at a version lower than one
// already persisted for the origin. Version 3 briefly shipped a beanPhotos
// store that was later reverted; rolling the constant back to 2 permanently
// broke any browser that had already upgraded to 3. Version 4 supersedes it
// with a cleanup step instead (see storage-upgrades.ts).
export const DATABASE_VERSION = 4
export const STORAGE_SCHEMA_VERSION = 2
export const SCHEMA_VERSION_KEY = 'schema-version'
