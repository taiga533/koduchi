import React from 'react'
import ReactDOM from 'react-dom/client'
import 'virtual:uno.css'
import './theme/fonts.css'
import './theme/tokens.css'
import './app.css'
import { App } from './App'
import { applyAppearance, defaultAppearance } from './theme/appearance'

applyAppearance(document.documentElement, defaultAppearance)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
