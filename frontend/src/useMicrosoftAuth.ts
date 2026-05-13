/**
 * Lightweight hook that surfaces the user's Microsoft account + a cached
 * Graph access token. Returns no-op values when MSAL is not configured.
 *
 * Implementation notes:
 *
 * - We do NOT use `useAccount` from msal-react: it expects an
 *   `AccountIdentifiers` shape, not the full `AccountInfo` that
 *   `useMsal().accounts` produces. Passing it the wrong shape silently
 *   returns `null`, which is why the topbar appeared stuck on "Sign in"
 *   even after a successful login.
 *
 * - We also do NOT rely solely on `useMsal().accounts`. In practice that
 *   array doesn't always propagate into our render cycle in time — there
 *   are timing gaps between MSAL's internal cache and msal-react's React
 *   state, especially right after a popup login. Instead we read the
 *   source of truth ourselves (`instance.getActiveAccount()` with a
 *   `getAllAccounts()` fallback) and subscribe to **every** MSAL event so
 *   any cache change triggers a refresh.
 *
 * - The MSAL cache lives in `localStorage` (see `auth.ts`). When the auth
 *   flow ends up in a separate tab (popup blocked / redirect fallback),
 *   that tab writes the account into localStorage. We listen for
 *   `storage` events and `visibilitychange` so the original tab picks up
 *   the new login without a manual reload.
 */
import {
  EventType,
  type AccountInfo,
  type AuthenticationResult,
  type EventMessage,
} from '@azure/msal-browser'
import { useMsal } from '@azure/msal-react'
import { useCallback, useEffect, useState } from 'react'
import {
  acquireGraphToken,
  GRAPH_READ_SCOPES,
  GRAPH_WRITE_SCOPES,
  isAzureConfigured,
  MSAL_ACCOUNT_KEYS_STORAGE_KEY,
  msalInstance,
} from './auth'

function pickInitialAccount(): AccountInfo | null {
  if (!isAzureConfigured() || !msalInstance) return null
  return (
    msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0] ?? null
  )
}

export interface MicrosoftAuthState {
  enabled: boolean
  isSignedIn: boolean
  username: string | null
  displayName: string | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  getToken: (scopes?: string[]) => Promise<string | null>
}

export function useMicrosoftAuth(): MicrosoftAuthState {
  const enabled = isAzureConfigured()
  const { instance } = useMsal()
  // Lazy initial state covers cold page loads where MSAL's sessionStorage
  // already contains an account (so the topbar shows the signed-in state on
  // first paint, not after a microtask).
  const [account, setAccount] = useState<AccountInfo | null>(pickInitialAccount)
  const [token, setToken] = useState<string | null>(null)

  // Keep `account` in sync with MSAL's internal cache via its event bus.
  useEffect(() => {
    if (!enabled) return

    function pickAccount(): AccountInfo | null {
      return instance.getActiveAccount() ?? instance.getAllAccounts()[0] ?? null
    }

    // Make sure the picked account is also "active" so silent token acquisition
    // works without prompting the user.
    const initial = pickAccount()
    if (initial && !instance.getActiveAccount()) {
      instance.setActiveAccount(initial)
    }

    const callbackId = instance.addEventCallback((event: EventMessage) => {
      // Promote a freshly-acquired account to active so silent token requests
      // (e.g. for /me/calendarView) succeed without a popup.
      if (
        event.eventType === EventType.LOGIN_SUCCESS ||
        event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS
      ) {
        const payload = event.payload as AuthenticationResult | null
        if (payload?.account) instance.setActiveAccount(payload.account)
      }
      if (event.eventType === EventType.LOGOUT_SUCCESS) {
        instance.setActiveAccount(null)
      }
      setAccount(pickAccount())
    })

    // Cross-tab sync: when another tab writes MSAL's account cache, refresh.
    function onStorage(e: StorageEvent) {
      if (!e.key || e.key.startsWith('msal.') || e.key === MSAL_ACCOUNT_KEYS_STORAGE_KEY) {
        setAccount(pickAccount())
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') setAccount(pickAccount())
    }
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      if (callbackId) instance.removeEventCallback(callbackId)
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, instance])

  // Refresh the Graph token when the signed-in account changes.
  useEffect(() => {
    let cancelled = false
    if (!enabled || !account) {
      Promise.resolve().then(() => {
        if (!cancelled) setToken(null)
      })
      return () => {
        cancelled = true
      }
    }
    acquireGraphToken(account, GRAPH_READ_SCOPES).then((t) => {
      if (!cancelled) setToken(t)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, account])

  const signIn = useCallback(async () => {
    if (!enabled) return
    try {
      const result = await instance.loginPopup({ scopes: GRAPH_READ_SCOPES })
      if (result.account) {
        instance.setActiveAccount(result.account)
        setAccount(result.account)
      }
    } catch (err) {
      console.error('Microsoft sign-in failed', err)
    }
  }, [enabled, instance])

  const signOut = useCallback(async () => {
    if (!enabled) return
    try {
      await instance.logoutPopup()
    } catch (err) {
      console.error('Microsoft sign-out failed', err)
    } finally {
      setAccount(null)
    }
  }, [enabled, instance])

  const getToken = useCallback(
    async (scopes: string[] = GRAPH_READ_SCOPES) => {
      if (!enabled || !account) return null
      if (scopes === GRAPH_READ_SCOPES && token) return token
      // Keep GRAPH_WRITE_SCOPES referenced so the export isn't tree-shaken
      // away when the consumer asks for the write scope.
      void GRAPH_WRITE_SCOPES
      return acquireGraphToken(account, scopes)
    },
    [enabled, account, token],
  )

  return {
    enabled,
    isSignedIn: enabled && !!account,
    username: account?.username ?? null,
    displayName: account?.name ?? account?.username ?? null,
    signIn,
    signOut,
    getToken,
  }
}
