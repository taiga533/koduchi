/**
 * 素の CSS から規則 1 つぶんの宣言を読み出す（ADR 0031）。
 *
 * `app.css` の土台の決め方（本体の高さ、document をスクロールさせないこと）は
 * JavaScript の関数ではなく CSS の宣言そのものである。jsdom はレイアウトを持た
 * ないため「実際にスクロールしないこと」はテストできないが、**決めた宣言が
 * 消えていないこと**なら確かめられる。そのための読み取りをここへ寄せてある。
 *
 * 相手にするのは入れ子の無い平らな stylesheet だけである。`@media` のような
 * ブロックを持つ at-rule は解さない（`app.css` には無い。`tokens.css` のような
 * at-rule を含む file をこの関数へ渡さないこと）。
 */

/** 註釈を落とす。`app.css` の註釈は入れ子にならない。 */
function 註釈を落とす(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * 選択子に対して書かれている宣言を property → value で返す。
 *
 * 選択子の並び（`html, body` のようにカンマで繋いだもの）は 1 つずつに割って
 * 照合する。同じ選択子への規則が複数あれば、後に書かれたものが勝つ（CSS の
 * 決まりと同じ）。
 *
 * @param css 平らな stylesheet の中身
 * @param selector 探す選択子（`html` など。前後の空白は無視する）
 *
 * @returns 見つかった宣言。1 つも無ければ空の `Map`
 */
export function declarationsFor(css: string, selector: string): Map<string, string> {
  const 探す選択子 = selector.trim()
  const found = new Map<string, string>()

  for (const [, 選択子の並び, 中身] of 註釈を落とす(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const 選択子たち = 選択子の並び.split(',').map((one) => one.trim())
    if (選択子たち[0]?.startsWith('@') || !選択子たち.includes(探す選択子)) {
      continue
    }
    for (const 宣言 of 中身.split(';')) {
      const 区切り = 宣言.indexOf(':')
      if (区切り === -1) {
        continue
      }
      found.set(宣言.slice(0, 区切り).trim(), 宣言.slice(区切り + 1).trim())
    }
  }

  return found
}
