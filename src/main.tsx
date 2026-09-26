import React from 'react'
import ReactDOM from 'react-dom/client'
import 'virtual:uno.css'
import './theme/fonts.css'
import './theme/tokens.css'
import './app.css'
import { App } from './App'
import { applyAppearance, defaultAppearance } from './theme/appearance'
import { installNativeMenuGuard } from './input/nativeContextMenu'

applyAppearance(document.documentElement, defaultAppearance)
// ウィンドウが生きている間ずっと効かせるため、外さない（ADR 0038）。
installNativeMenuGuard(window)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
