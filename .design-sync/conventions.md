# 小槌（koduchi）で画面を組むときの決まり

小槌は macOS 向けの Oracle クライアント。等幅の PlemolJP 1 書体で、面は淡い灰と白、アクセントはオリーブ 1 色だけを使う。

## 準備

- `styles.css` を 1 枚読めば、トークン・書体・部品の CSS がそろう。**`window.Koduchi` を読み込んだ時点で DB の窓口が「答えが返らない」代役に差し替わる**ので、部品が裏で DB を呼んでも例外は出ない。
- テーマはルート要素の `data-theme` で切り替える（属性なし＝システム追従、`"light"` / `"dark"`）。結果テーブルの行の高さは `data-row-height="comfortable"`、罫線を消すのは `data-grid-lines="off"`。どれも既定のときは属性を付けない。`applyAppearance(document.documentElement, { ...defaultAppearance, theme: 'dark' })` でもよい。

## 状態はストアに置く

多くの部品は **props ではなく zustand のストアから状態を読む**。描く前に `setState` で置くこと。置かないと空の姿（未接続・タブ無し）になる。

| 部品                                          | 読むストア                                                    |
| --------------------------------------------- | ------------------------------------------------------------- |
| `TitleBar` / `StatusBar` / `ConnectionPicker` | `useConnectionStore`（`status: 'connected'`、`connection`）   |
| `StatusBar`                                   | 加えて `useExecutionStore.inTransaction`、`useUiStore.cursor` |
| `TabBar`                                      | `useTabStore`（`tabs` / `activeTabId`）                       |
| `Sidebar` / `SchemaTree`                      | `useSchemaStore`、`useUiStore.sidebarSegment`                 |
| `ResultPane`                                  | `useExecutionStore.byTab[tabId]`（`TabExecution`）            |
| `TableDefinitionPanel`                        | `useDefinitionStore.byTab[tabId]`                             |
| `HistoryList` / `SavedQueryList`              | `useHistoryStore` / `useSavedQueryStore`                      |
| `SessionsPanel` / `SourceSearchPanel`         | `useSessionsStore` / `useSourceSearchStore`                   |

描いた直後に一覧を読みにいく部品（`ConnectionPicker` / `ConnectionForm` / `CommandPalette`）には、答えを置いた窓口を渡す。書かなかったメソッドは決着しない。

```jsx
const { setDbApi, createDesignDbApi } = window.Koduchi
setDbApi(createDesignDbApi({ listSavedConnections: async () => savedConnections }))
```

`ResultTable` だけは props で受ける。`execution` は `TabExecution`（`status: 'succeeded'`、`columns: [{ name, typeName, kind }]`、`rows: Cell[][]`、`exhausted`、`elapsedMs`、`affectedRows: null`、`isStatement: false`、`error: null`、`loadingMore: false`、`progress: null`）。`Cell` は `{ text, kind }` で、`kind` は `'number' | 'text' | 'datetime' | 'bool' | 'binary' | 'null'`。数値は右寄せ、`null` は淡い `NULL` で出る。

## 見た目の書き方

**色の値を直に書かない。** トークンの CSS 変数か、それを参照する UnoCSS のクラスを使う。

| 役割                                 | 変数                            | クラス                                                                     |
| ------------------------------------ | ------------------------------- | -------------------------------------------------------------------------- |
| 地 / 面 / 淡い面                     | `--bg` / `--panel` / `--panel2` | `bg-bg` / `bg-panel` / `bg-panel2`                                         |
| 塗り（押せる面・選択）               | `--fill` / `--fill2`            | `bg-fill` / `bg-fill2` / `hover:bg-fill`                                   |
| 罫線                                 | `--line` / `--line2`            | `border border-line` / `border-line2`                                      |
| 文字（数字が大きいほど淡い）         | `--fg` 〜 `--fg6`               | `text-fg` / `text-fg2` / `text-fg3` / `text-fg4` / `text-fg5` / `text-fg6` |
| アクセント（オリーブ）とその上の文字 | `--ac` / `--acfg`               | `bg-ac` / `text-ac` / `text-acfg`                                          |
| エラー / 注意 / 検索の当たり         | `--err` / `--warn` / `--hit`    | `text-err` / `text-warn` / `bg-hit`                                        |
| 接続の色                             | `--cn-red` など 7 色            | —                                                                          |
| 書体                                 | `--font-mono`                   | `font-mono`                                                                |

寸法のクラスは部品の中で使われたものしか生成されていない（`text-11px` / `text-12px` / `text-13px` / `gap-8px` / `px-14px` / `h-26px` / `rounded-6px` / `rounded-8px` は在る）。**自分で組む配置の糊は、無いクラスを作らず `style` に `var(--*)` で書く。** 文字は 11〜13px、角丸は 6〜8px が基調。アイコンは lucide で 12〜15px。

正本は `styles.css` とその読み込み先（`_ds_bundle.css`・`fonts/fonts.css`）、部品ごとの使い方は `components/<group>/<Name>/<Name>.prompt.md` にある。

## 例

```jsx
const { StatusBar, ResultTable, useConnectionStore } = window.Koduchi

useConnectionStore.setState({
  status: 'connected',
  error: null,
  connection: {
    id: 'c1',
    savedId: null,
    name: 'HR（開発）',
    color: 'green',
    group: null,
    completion: { identifierCase: 'preserve' },
    params: {
      username: 'hr',
      password: '',
      readOnly: false,
      autoCommit: false,
      target: {
        method: 'ezConnect',
        host: 'db.example.internal',
        port: 1521,
        serviceName: 'HRDEV',
      },
    },
  },
})

const App = () => (
  <div
    style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}
  >
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--panel)',
        borderTop: '1px solid var(--line)',
      }}
    >
      <ResultTable tabId="t1" execution={execution} onRequestMore={() => {}} />
    </div>
    <StatusBar onOpenSettings={() => {}} onDisconnect={() => {}} onSwitchConnection={() => {}} />
  </div>
)
```
