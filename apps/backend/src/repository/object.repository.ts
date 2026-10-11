import type { ObjectDao, ObjectRecord } from '../dao/object.interface.ts'
export type DesignObject = Omit<ObjectRecord, 'definition'> & { definition: unknown }
const toObject = ({ definition, ...row }: ObjectRecord): DesignObject => ({
  ...row,
  definition: JSON.parse(definition) as unknown,
})
export const createObjectRepository = (dao: ObjectDao) => ({
  findContext: dao.findContext,
  findScope: async (id: string, since?: number) => {
    const scope = await dao.findScope(id, since)
    return scope ? { context: scope.context, objects: scope.objects.map(toObject) } : null
  },
  save: async (
    input: Omit<Parameters<ObjectDao['save']>[0], 'record'> & { record: DesignObject },
  ) => {
    const result = await dao.save({
      ...input,
      record: { ...input.record, definition: JSON.stringify(input.record.definition) },
    })
    return { ...result, object: toObject(result.object) }
  },
})
export type ObjectRepository = ReturnType<typeof createObjectRepository>
