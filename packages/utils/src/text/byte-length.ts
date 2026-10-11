const encoder = new TextEncoder()

/** Length of a string in UTF-8 bytes, as databases count identifier lengths (e.g. PostgreSQL's 63 bytes). */
export const utf8ByteLength = (value: string): number => encoder.encode(value).length
