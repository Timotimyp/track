import { MsalProvider } from '@azure/msal-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { msalInstance } from './auth'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

if (msalInstance) {
  // Required by MSAL before any other API call. Resolves any redirect-based
  // login response that may be present in the URL after returning from
  // login.microsoftonline.com.
  const instance = msalInstance
  instance
    .initialize()
    .then(() => instance.handleRedirectPromise())
    .finally(() => {
      root.render(
        <StrictMode>
          <MsalProvider instance={instance}>
            <App />
          </MsalProvider>
        </StrictMode>,
      )
    })
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
