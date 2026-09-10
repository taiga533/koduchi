# 貢献の手引き

プルリクエストを歓迎する。Issue だけでも助かる。

## 先に読むもの

- [`adr/README.md`](adr/README.md) — 設計判断はすべてここに記録してある。**ADR で決まったことは蒸し返さない。** 却下した案とその理由も各 ADR に書いてある
- [`CLAUDE.md`](CLAUDE.md) — モジュールの割り当て、キーバインドの置き場所、デザイントークンの扱いなど、実装の前提

ADR で決まっていない判断が必要になったら、実装を始める前に Issue で相談してほしい。

## 開発

環境の用意とコマンドは [`README.md`](README.md) にある。手元で通してから出すこと。

```bash
bun run build        # tsc の型チェック + vite ビルド
bun run test         # vitest
bun run lint         # oxlint
bun run format       # prettier
cd src-tauri && cargo fmt && cargo clippy && cargo test
```

CI は `oxlint --deny-warnings` と `clippy -D warnings` で回すので、警告 1 件で赤になる。

## 書き方

- **すべての実装にテストを書く。** テストは Arrange - Act - Assert の順で、テストケース名は日本語で何を確かめているかを書く
- mock は最小限に留める。フロントエンドは `src/api/` 層の差し替えで代替する
- ドキュメントとコミットメッセージは日本語で書く
- 関数を宣言するときは、その説明を Docstring に書く

## コミット

**すべてのコミットに `Signed-off-by` を付ける。**

```bash
git commit -s -m "..."
```

これは後述の「貢献のライセンス条件」に同意した証跡として扱う。

## 貢献のライセンス条件

**正文は下の English 版である。以下の日本語はその参考訳であり、法的効力はない。**

プルリクエストを送ることにより、あなたは次に同意したものとする。

1. あなたの貢献は、[`LICENSE`](LICENSE) と同じ条件で本プロジェクトに提供される。
2. あわせてあなたは、ライセンサー（Taiga Kawasaki）に対し、**世界的・非独占的・無償・取消不能・永続的な**許諾を与える。この許諾には、あなたの貢献を利用・複製・改変し、派生物を作成し、**有償の商用ライセンスを含む任意の条件で再ライセンスして配布する**権利を含む。
3. あなたは、あなたの貢献のうち特許を必要とする部分について、同様の条件で特許許諾を与える。
4. あなたは、この許諾を与える権利を有することを表明する。勤務先その他があなたの成果物に権利を持ちうる場合は、**あらかじめその許可を得ていること。**
5. あなたの貢献は、あなた自身の著作物であるか、適切な出所の表示とともに提出されたものである。

2 は、将来 1.0.0 以降で有償の商用ライセンスを提供できるようにするために必要である（[ADR 0029](adr/0029-ライセンスと商用利用の扱い.md)）。これが無いと、貢献を含んだ版を商用ライセンスとして提供できなくなる。

### Contribution Terms (controlling version)

By submitting a pull request or otherwise contributing to koduchi, you agree to
the following.

1. Your contribution is provided to the project under the terms of
   [`LICENSE`](LICENSE).
2. You additionally grant Taiga Kawasaki (the licensor) a worldwide,
   non-exclusive, royalty-free, irrevocable, perpetual license to use,
   reproduce, modify, prepare derivative works of, publicly display, publicly
   perform, sublicense, and distribute your contribution and such derivative
   works, **under any terms, including paid commercial terms**.
3. You grant a patent license on the same terms, covering patent claims you can
   license that are necessarily infringed by your contribution alone or by
   combination of your contribution with the software.
4. You represent that you are legally entitled to grant the above licenses. If
   your employer or any other party has rights to work you create, you
   represent that you have received permission to make the contribution on
   their behalf.
5. Your contribution is your original creation, or is submitted with complete
   details of any third-party source.

You signal your agreement by adding a `Signed-off-by` line to each commit
(`git commit -s`).
