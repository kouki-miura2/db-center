import type { PgSession } from './postgres.interface.ts'

// OIDs and sequence counters are deliberately absent: they change without a design change.
// pg_catalog-qualified deparsers make a restored catalog comparable to its previous snapshot.
export const postgresCatalogQuery = `WITH namespaces AS (
 SELECT oid,nspname FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema','_dbcenter')
), relations AS (
 SELECT c.*,n.nspname FROM pg_catalog.pg_class c JOIN namespaces n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','v','m','S','f')
), entries AS (
 SELECT 'schema:'||nspname AS key,jsonb_build_object('owner',pg_catalog.pg_get_userbyid(n.nspowner),'comment',pg_catalog.obj_description(n.oid,'pg_namespace')) AS value FROM pg_catalog.pg_namespace n JOIN namespaces s USING(oid,nspname)
 UNION ALL
 SELECT 'relation:'||nspname||'.'||relname,jsonb_build_object(
 'kind',relkind,'owner',pg_catalog.pg_get_userbyid(relowner),'options',coalesce((SELECT jsonb_agg(v ORDER BY v) FROM unnest(reloptions) v),'[]'::jsonb),
 'persistence',relpersistence,'rowSecurity',relrowsecurity,'forceRowSecurity',relforcerowsecurity,'comment',pg_catalog.obj_description(r.oid,'pg_class'),
 'columns',coalesce((SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'storage',a.attstorage,'compression',a.attcompression,'collation',CASE WHEN a.attcollation<>0 THEN a.attcollation::regcollation::text ELSE NULL END,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid),'comment',pg_catalog.col_description(a.attrelid,a.attnum)) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),
 'constraints',coalesce((SELECT jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_catalog.pg_get_constraintdef(c.oid,false),'validated',c.convalidated) ORDER BY c.conname) FROM pg_catalog.pg_constraint c WHERE c.conrelid=r.oid),'[]'::jsonb),
 'indexes',coalesce((SELECT jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_catalog.pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'options',c.reloptions) ORDER BY c.relname) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=r.oid),'[]'::jsonb),
 'view',CASE WHEN relkind IN ('v','m') THEN pg_catalog.pg_get_viewdef(r.oid,false) ELSE NULL END,
 'sequence',(SELECT jsonb_build_object('type',pg_catalog.format_type(seqtypid,NULL),'start',seqstart::text,'increment',seqincrement::text,'min',seqmin::text,'max',seqmax::text,'cache',seqcache::text,'cycle',seqcycle) FROM pg_catalog.pg_sequence WHERE seqrelid=r.oid),
 'triggers',coalesce((SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled) ORDER BY t.tgname) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal),'[]'::jsonb),
 'policies',coalesce((SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_catalog.pg_policy p WHERE p.polrelid=r.oid),'[]'::jsonb),
 'ownedBy',(SELECT jsonb_agg(jsonb_build_object('table',cn.nspname||'.'||c.relname,'column',a.attname) ORDER BY cn.nspname,c.relname,a.attname) FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class c ON c.oid=d.refobjid JOIN pg_catalog.pg_namespace cn ON cn.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.refobjsubid WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=r.oid AND d.deptype IN ('a','i'))
 ) FROM relations r
 UNION ALL SELECT 'function:'||n.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',jsonb_build_object('definition',pg_catalog.pg_get_functiondef(p.oid),'owner',pg_catalog.pg_get_userbyid(p.proowner)) FROM pg_catalog.pg_proc p JOIN namespaces n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p')
 UNION ALL SELECT 'type:'||n.nspname||'.'||t.typname,jsonb_build_object('kind',t.typtype,'base',pg_catalog.format_type(t.typbasetype,t.typtypmod),'notNull',t.typnotnull,'default',t.typdefault,'enum',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_catalog.pg_enum e WHERE e.enumtypid=t.oid),'constraints',(SELECT jsonb_agg(pg_catalog.pg_get_constraintdef(c.oid,false) ORDER BY c.conname) FROM pg_catalog.pg_constraint c WHERE c.contypid=t.oid)) FROM pg_catalog.pg_type t JOIN namespaces n ON n.oid=t.typnamespace WHERE t.typrelid=0 AND t.typelem=0 AND t.typtype IN ('d','e','r','m','b')
 UNION ALL SELECT 'extension:'||extname,jsonb_build_object('version',extversion,'schema',n.nspname) FROM pg_catalog.pg_extension e JOIN namespaces n ON n.oid=e.extnamespace WHERE extname<>'plpgsql'
) SELECT coalesce(jsonb_object_agg(key,value ORDER BY key),'{}'::jsonb) AS catalog FROM entries`

export const readPostgresCatalog = async (session: PgSession) =>
  (await session.query(postgresCatalogQuery)).rows[0]!.catalog as Record<string, unknown>
