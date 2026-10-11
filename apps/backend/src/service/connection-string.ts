import { AppError } from '../error.ts'

/**
 * Checks a PostgreSQL connection string (`postgresql://user@host:port/db?...`): a URI with a
 * host, and no password, which goes in its own field and is stored encrypted. Returns it trimmed.
 * Which hosts may be reached is checked when connecting (automatic build/migration).
 */
export const validateConnectionString = (value: string): string => {
  const invalid = (message: string) =>
    new AppError('invalid_input', { fields: { connectionString: message } })
  const trimmed = value.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw invalid('postgresql://ユーザー名@ホスト:ポート/データベース名 の形式で入力してください')
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw invalid('postgresql:// で始まる接続文字列を入力してください')
  }
  if (!url.hostname) throw invalid('ホスト名を入力してください')
  if (url.password || url.searchParams.has('password')) {
    throw invalid('パスワードは接続文字列に含めず、パスワード欄に入力してください')
  }
  return trimmed
}
