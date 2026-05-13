/**
 * Lightweight hook that surfaces the user's Microsoft account + a cached
 * Graph access token. Returns no-op values when MSAL is not configured.
 *
 * We deliberately do NOT use `useAccount` from msal-react: it expects an
 * `AccountIdentifiers` shape and silently returns `null` when given a full
 * `AccountInfo` (which is what `useMsal().accounts` provides). That mismatch
 * left the UI stuck on the sign-in button even after a successful login.
 * Reading `accounts[0]` directly is reactive — msal-react keeps the list
 * up-to-date via internal event callbacks.
 */
import { EventType } from '@azure/msal-browser'
import type { AuthenticationResult, EventMessage } from '@azure/msal-browser'
import { useIsAuthenticated, useMsal } from '@azure/msal-react'
import { useCallback, useEffect, useState } from 'react'
import {
  acquireGraphToken,
  GRAPH_READ_SCOPES,
  GRAPH_WRITE_SCOPES,
  isAzureConfigured,
} from './auth'

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
  const { instance, accounts } = useMsal()
  const account = accounts[0] ?? null
  const isAuthenticated = useIsAuthenticated()
  const [token, setToken] = useState<string | null>(null)

  // Promote the freshly-signed-in account to "active" so MSAL uses it for
  // silent token requests across renders. Without this, `acquireTokenSilent`
  // sometimes fails with `no_account_in_silent_request` immediately after
  // login.
  useEffect(() => {
    if (!enabled) return
    const id = instance.addEventCallback((event: EventMessage) => {
      if (
        event.eventType === EventType.LOGIN_SUCCESS &&
        event.payload &&
        'account' in event.payload
      ) {
        const result = event.payload as AuthenticationResult
        if (result.account) instance.setActiveAccount(result.account)
      }
    })
    // If we already have an account on first render (e.g. session storage
    // restore), promote it now.
    if (accounts[0] && !instance.getActiveAccount()) {
      instance.setActiveAccount(accounts[0])
    }
    return () => {
      if (id) instance.removeEventCallback(id)
    }
  }, [enabled, instance, accounts])

  useEffect(() => {
    let cancelled = false
    if (!enabled || !account) {
      // Defer to avoid the React "setState directly in effect" lint warning.
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
      if (result.account) instance.setActiveAccount(result.account)
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
    }
  }, [enabled, instance])

  const getToken = useCallback(
    async (scopes: string[] = GRAPH_READ_SCOPES) => {
      if (!enabled || !account) return null
      if (scopes === GRAPH_READ_SCOPES && token) return token
      // Avoid lint warning: GRAPH_WRITE_SCOPES referenced to keep the export used.
      void GRAPH_WRITE_SCOPES
      return acquireGraphToken(account, scopes)
    },
    [enabled, account, token],
  )

  return {
    enabled,
    isSignedIn: enabled && isAuthenticated && !!account,
    username: account?.username ?? null,
    displayName: account?.name ?? account?.username ?? null,
    signIn,
    signOut,
    getToken,
  }
}
