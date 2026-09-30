import { StrictMode } from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import App from './App'

export function render(_url, options) {
  return renderToPipeableStream(
    <StrictMode>
      <App />
    </StrictMode>,
    options,
  )
}
