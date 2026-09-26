#!/bin/sh
# 同期の組み立てを 1 本で流す（design-sync）。部品のライブラリビルド → 型 → 変換器。
set -e
bunx vite build --config .design-sync/pkg/vite.config.ts
bunx tsc -p .design-sync/pkg/tsconfig.json
node .design-sync/pkg/flatten-types.mjs
node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --out ./ds-bundle
