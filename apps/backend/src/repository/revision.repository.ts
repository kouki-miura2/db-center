import type { RevisionDao, RevisionsRecord } from '../dao/revision.interface.ts'

export type Revisions = RevisionsRecord

export interface RevisionRepository {
  findRevisions: RevisionDao['findRevisions']
}

/** Revisions are plain numbers by ID: nothing to map. */
export const createRevisionRepository = (dao: RevisionDao): RevisionRepository => ({
  findRevisions: (input) => dao.findRevisions(input),
})
