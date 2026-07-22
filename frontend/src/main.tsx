import * as Sentry from '@sentry/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { EmailProvider, UIProvider } from './contexts'

Sentry.init({
  dsn: (import.meta.env.VITE_SENTRY_DSN as string) ?? '',
  tracesSampleRate: 0.1,
  enabled: Boolean(import.meta.env.VITE_SENTRY_DSN),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UIProvider>
      <EmailProvider>
        <App />
      </EmailProvider>
    </UIProvider>
  </StrictMode>
)
