/** Saves `content` as a file named `name` in the browser (nothing is stored on the server). */
export const downloadFile = (name: string, content: BlobPart, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // The download has started by then; the URL only needs to outlive the click.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
