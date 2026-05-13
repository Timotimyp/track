/**
 * MSAL.js configuration for Azure AD (Entra ID) sign-in.
 *
 * - Uses the SPA "auth code with PKCE" flow — no client secret is needed,
 *   and the token never touches our backend except as an Authorization
 *   header that we forward to Microsoft Graph.
 * - `clientId` and `tenantId` are read from `VITE_AZURE_CLIENT_ID` and
 *   `VITE_AZURE_TENANT_ID`. When either is missing the app behaves exactly
 *   like before (no Sign in button, no calendar integration).
 *
 * Scopes:
 *   - `User.Read`        — read the signed-in user's profile (used for the
 *                          avatar/name in the topbar).
 *   - `Calendars.Read`   — read the user's Outlook calendar to detect
 *                          conflicts when the AI suggests a slot.
 *   - `Calendars.ReadWrite` — only requested when the user opts into
 *                          "Also add to my Outlook" in the task modal; until
 *                          they tick the box we stick with the read-only
 *                          scope so consent screens stay minimal.
 */
import {
  PublicClientApplication,
  type AccountInfo,
  type Configuration,
  type SilentRequest,
} from '@azure/msal-browser'

export const AZURE_CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined
export const AZURE_TENANT_ID =
  (import.meta.env.VITE_AZURE_TENANT_ID as string | undefined) || 'common'

export const GRAPH_READ_SCOPES = ['User.Read', 'Calendars.Read']
export const GRAPH_WRITE_SCOPES = ['User.Read', 'Calendars.ReadWrite']

export function isAzureConfigured(): boolean {
  return !!AZURE_CLIENT_ID && AZURE_CLIENT_ID.length > 0
}

export function buildMsalConfig(): Configuration | null {
  if (!isAzureConfigured()) return null
  return {
    auth: {
      clientId: AZURE_CLIENT_ID as string,
      authority: `https://login.microsoftonline.com/${AZURE_TENANT_ID}`,
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: {
      // localStorage so that if the auth flow ends up in a new tab
      // (popup blocked, redirect fallback, etc.) the original tab also
      // sees the freshly-signed-in account and can update its UI via the
      // `storage` event — see `useMicrosoftAuth` for the listener.
      cacheLocation: 'localStorage',
    },
  }
}

/** localStorage key that MSAL writes when its account cache changes. */
export const MSAL_ACCOUNT_KEYS_STORAGE_KEY = 'msal.account.keys'

export const msalInstance: PublicClientApplication | null = (() => {
  const cfg = buildMsalConfig()
  return cfg ? new PublicClientApplication(cfg) : null
})()

/** Acquire a Graph access token silently (falls back to popup on first call). */
export async function acquireGraphToken(
  account: AccountInfo,
  scopes: string[] = GRAPH_READ_SCOPES,
): Promise<string | null> {
  if (!msalInstance) return null
  const request: SilentRequest = { account, scopes }
  try {
    const result = await msalInstance.acquireTokenSilent(request)
    return result.accessToken
  } catch {
    try {
      const result = await msalInstance.acquireTokenPopup({ scopes })
      return result.accessToken
    } catch {
      return null
    }
  }
}
