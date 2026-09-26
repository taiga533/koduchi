import { ResultSearchBar } from 'koduchi-ui'

const noop = () => {}

const base = {
  onNeedleChange: noop,
  onCaseSensitiveChange: noop,
  onStep: noop,
  onClose: noop,
  onToggleRest: noop,
  // 0 のままにして焦点を奪わせない（カードを並べたときに入力欄が選ばれっぱなしになる）。
  focusToken: 0,
}

const frame = { width: 860, background: 'var(--panel)' } as const

/** 全行を取り終えた結果で探したとき。件数だけで範囲の断りは要らない。 */
export const AllRowsScanned = () => (
  <div style={frame}>
    <ResultSearchBar
      {...base}
      needle="営業部"
      caseSensitive={false}
      summary="2 / 5 件"
      note={null}
      hasMore={false}
      loadingRest={false}
    />
  </div>
)

/** カーソルが残っているとき。走査した行数を添え、「残りを読み込んで探す」を出す。 */
export const PartialRows = () => (
  <div style={frame}>
    <ResultSearchBar
      {...base}
      needle="Kochhar"
      caseSensitive
      summary="1 / 3 件（取得済みの 1,000 行のうち）"
      note={null}
      hasMore
      loadingRest={false}
    />
  </div>
)

/** 当たりが無く、切り詰められた CLOB も探したとき。断り書きが警告色で出る。 */
export const NoMatchWithTruncatedNote = () => (
  <div style={frame}>
    <ResultSearchBar
      {...base}
      needle="退職予定"
      caseSensitive={false}
      summary="一致なし"
      note="一部の値は先頭 64 KB までしか探していません"
      hasMore={false}
      loadingRest={false}
    />
  </div>
)
