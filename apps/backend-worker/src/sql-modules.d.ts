declare module 'libpg-query/wasm/libpg-query.js' {
  export interface PgModule {
    lengthBytesUTF8: (s: string) => number
    _malloc: (n: number) => number
    _free: (p: number) => void
    stringToUTF8: (s: string, p: number, n: number) => void
    UTF8ToString: (p: number) => string
    getValue: (p: number, type: string) => number
    _wasm_parse_query_raw: (p: number) => number
    _wasm_free_parse_result: (p: number) => void
  }
  const init: (options?: {
    instantiateWasm?: (
      imports: WebAssembly.Imports,
      receive: (instance: WebAssembly.Instance) => void,
    ) => WebAssembly.Exports
    wasmBinary?: Uint8Array
  }) => Promise<PgModule>
  export default init
}
declare module 'sql.js/dist/sql-wasm.js' {
  export interface SqlDatabase {
    run: (sql: string) => void
    prepare: (sql: string) => { getColumnNames: () => string[]; free: () => void }
    close: () => void
  }
  const init: (options?: {
    instantiateWasm?: (
      imports: WebAssembly.Imports,
      receive: (instance: WebAssembly.Instance) => void,
    ) => WebAssembly.Exports
    wasmBinary?: Uint8Array
  }) => Promise<{ Database: new () => SqlDatabase }>
  export default init
}
declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}
