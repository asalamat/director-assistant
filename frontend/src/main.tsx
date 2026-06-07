import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { EmailProvider, UIProvider } from './contexts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UIProvider>
      <EmailProvider>
        <App />
      </EmailProvider>
    </UIProvider>
  </StrictMode>
)
