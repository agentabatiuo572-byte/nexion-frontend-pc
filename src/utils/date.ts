export function formatDateTime(value: unknown): string {
  if (value == null || value === '') return '-'
  if (value instanceof Date) return formatDateParts(value)

  const text = String(value).trim()
  if (!text) return '-'

  const normalized = text.includes('T') ? text.replace('T', ' ') : text
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})[ ](\d{2}:\d{2}:\d{2})/)
  if (match) return `${match[1]} ${match[2]}`

  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) return formatDateParts(parsed)
  return text
}

export function formatNow(): string {
  return formatDateParts(new Date())
}

export function formatTableDateTime(_row: unknown, _column: unknown, cellValue: unknown): string {
  return formatDateTime(cellValue)
}

function formatDateParts(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds())
  ].join('')
}
