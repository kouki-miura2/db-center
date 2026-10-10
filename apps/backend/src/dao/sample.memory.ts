import type { SampleDao, SampleRecord } from './sample.interface.ts'

const records: SampleRecord[] = [
  { id: '1', label: 'First sample record' },
  { id: '2', label: 'Second sample record' },
]

/** Default in-memory `SampleDao`. Projects add datastore-backed DAOs in the runtime package's `src/dao/`. */
export const createSampleDao = (): SampleDao => ({
  findById: async (id) => records.find((record) => record.id === id) ?? null,
})
