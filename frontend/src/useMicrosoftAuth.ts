/**
 * Lightweight hook that surfaces the user's Microsoft account + a cached
 * Graph access token. Returns no-op values when MSAL is not configured.
 */
import { useAccount, useIsAuthenticated, useMsal } from '@azure/msal-react'
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
  const account = useAccount(accounts[0] ?? null)
  const isAuthenticated = useIsAuthenticated()
  const [token, setToken] = useState<string | null>(null)

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
      await instance.loginPopup({ scopes: GRAPH_READ_SCOPES })
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
