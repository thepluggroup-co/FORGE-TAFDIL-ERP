import React, { useState, useMemo, useCallback } from 'react'

export interface Column<T> {
  id: string
  header: string
  accessor: keyof T | ((row: T) => React.ReactNode)
  render?: (value: unknown, row: T) => React.ReactNode
  sortable?: boolean
}

export interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[]
  data: T[]
  onRowClick?: (row: T) => void
  loading?: boolean
  keyField?: keyof T
  emptyMessage?: string
}

type SortDir = 'asc' | 'desc' | null

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const

function getCellValue<T extends Record<string, unknown>>(row: T, accessor: Column<T>['accessor']): unknown {
  return typeof accessor === 'function' ? accessor(row) : row[accessor]
}

function exportCsv<T extends Record<string, unknown>>(columns: Column<T>[], data: T[]) {
  const headers = columns.map((c) => c.header).join(',')
  const rows = data.map((row) =>
    columns.map((c) => {
      const v = getCellValue(row, c.accessor)
      const str = String(v ?? '')
      return str.includes(',') ? `"${str}"` : str
    }).join(','),
  )
  const csv = [headers, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `export-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td className="px-4 py-3"><div className="h-4 w-4 bg-gray-200 rounded animate-pulse" /></td>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: `${60 + Math.random() * 30}%` }} />
        </td>
      ))}
    </tr>
  )
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
  loading = false,
  keyField,
  emptyMessage = 'Aucun résultat',
}: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<10 | 25 | 50>(10)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const filtered = useMemo(() => {
    if (!search.trim()) return data
    const q = search.toLowerCase()
    return data.filter((row) =>
      columns.some((col) => {
        const v = getCellValue(row, col.accessor)
        return String(v ?? '').toLowerCase().includes(q)
      }),
    )
  }, [data, search, columns])

  const sorted = useMemo(() => {
    if (!sortCol || !sortDir) return filtered
    const col = columns.find((c) => c.id === sortCol)
    if (!col) return filtered
    return [...filtered].sort((a, b) => {
      const av = String(getCellValue(a, col.accessor) ?? '')
      const bv = String(getCellValue(b, col.accessor) ?? '')
      const cmp = av.localeCompare(bv, 'fr', { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortCol, sortDir, columns])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const paginated = sorted.slice((page - 1) * pageSize, page * pageSize)

  const toggleSort = useCallback((colId: string) => {
    setSortCol((prev) => {
      if (prev !== colId) { setSortDir('asc'); return colId }
      setSortDir((d) => (d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc'))
      return colId
    })
    setPage(1)
  }, [])

  const toggleSelectAll = () => {
    setSelected((prev) =>
      prev.size === paginated.length ? new Set() : new Set(paginated.map((_, i) => (page - 1) * pageSize + i)),
    )
  }

  const toggleRow = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 gap-3">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m0 0A7 7 0 104.65 4.65a7 7 0 0012 12z" />
          </svg>
          <input
            type="search"
            placeholder="Rechercher..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-[#C62828] focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <span className="text-xs text-[#C62828] font-medium">{selected.size} sélectionné(s)</span>
          )}
          <button
            onClick={() => exportCsv(columns, selected.size > 0 ? [...selected].map((i) => sorted[i]).filter(Boolean) : sorted)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
              border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Exporter CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: '#C62828' }}>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={paginated.length > 0 && selected.size === paginated.length}
                  onChange={toggleSelectAll}
                  className="rounded border-white/50 text-white focus:ring-white/50"
                />
              </th>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wide whitespace-nowrap"
                  style={{ cursor: col.sortable !== false ? 'pointer' : 'default', userSelect: 'none' }}
                  onClick={() => col.sortable !== false && toggleSort(col.id)}
                >
                  <span className="flex items-center gap-1">
                    {col.header}
                    {col.sortable !== false && (
                      <span className="opacity-60">
                        {sortCol === col.id ? (sortDir === 'asc' ? '↑' : sortDir === 'desc' ? '↓' : '↕') : '↕'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={columns.length} />)
            ) : paginated.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="text-center py-12 text-sm text-gray-400">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginated.map((row, rowIdx) => {
                const absIdx = (page - 1) * pageSize + rowIdx
                const isSelected = selected.has(absIdx)
                const key = keyField ? String(row[keyField]) : absIdx

                return (
                  <tr
                    key={key}
                    onClick={() => onRowClick?.(row)}
                    className={`transition-colors ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}
                      ${onRowClick ? 'cursor-pointer hover:bg-[#FFEBEE]' : ''}
                      ${isSelected ? 'bg-[#FFEBEE]' : ''}`}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(absIdx)}
                        className="rounded border-gray-300 text-[#C62828] focus:ring-[#C62828]"
                      />
                    </td>
                    {columns.map((col) => {
                      const raw = getCellValue(row, col.accessor)
                      return (
                        <td key={col.id} className="px-4 py-3 text-[#212121]">
                          {col.render ? col.render(raw, row) : String(raw ?? '—')}
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
        <div className="flex items-center gap-2">
          <span>Lignes :</span>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value) as 10 | 25 | 50); setPage(1) }}
            className="border border-gray-200 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          >
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>{sorted.length} résultat{sorted.length > 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(1)}
            disabled={page === 1}
            className="px-2 py-1 rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >«</button>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-2 py-1 rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >‹</button>
          <span className="px-3 font-medium text-[#212121]">{page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-2 py-1 rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >›</button>
          <button
            onClick={() => setPage(totalPages)}
            disabled={page === totalPages}
            className="px-2 py-1 rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >»</button>
        </div>
      </div>
    </div>
  )
}
