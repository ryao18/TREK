import { create } from 'zustand'
import { authApi } from '../api/client'
import { connect, disconnect } from '../api/websocket'

export const useAuthStore = create((set, get) => ({
  user: null,
  token: localStorage.getItem('auth_token') || null,
  isAuthenticated: !!localStorage.getItem('auth_token'),
  isLoading: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const data = await authApi.login({ email, password })
      localStorage.setItem('auth_token', data.token)
      set({
        user: data.user,
        token: data.token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      })
      connect(data.token)
      return data
    } catch (err) {
      const error = err.response?.data?.error || 'Anmeldung fehlgeschlagen'
      set({ isLoading: false, error })
      throw new Error(error)
    }
  },

  register: async (username, email, password) => {
    set({ isLoading: true, error: null })
    try {
      const data = await authApi.register({ username, email, password })
      localStorage.setItem('auth_token', data.token)
      set({
        user: data.user,
        token: data.token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      })
      connect(data.token)
      return data
    } catch (err) {
      const error = err.response?.data?.error || 'Registrierung fehlgeschlagen'
      set({ isLoading: false, error })
      throw new Error(error)
    }
  },

  logout: () => {
    disconnect()
    localStorage.removeItem('auth_token')
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      error: null,
    })
  },

  loadUser: async () => {
    const token = get().token
    if (!token) {
      set({ isLoading: false })
      return
    }
    set({ isLoading: true })
    try {
      const data = await authApi.me()
      set({
        user: data.user,
        isAuthenticated: true,
        isLoading: false,
      })
      connect(token)
    } catch (err) {
      localStorage.removeItem('auth_token')
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      })
    }
  },

  updateMapsKey: async (key) => {
    try {
      await authApi.updateMapsKey(key)
      set(state => ({
        user: { ...state.user, maps_api_key: key || null }
      }))
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Fehler beim Speichern des API-Schlüssels')
    }
  },

  updateApiKeys: async (keys) => {
    try {
      const data = await authApi.updateApiKeys(keys)
      set({ user: data.user })
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Fehler beim Speichern der API-Schlüssel')
    }
  },

  updateProfile: async (profileData) => {
    try {
      const data = await authApi.updateSettings(profileData)
      set({ user: data.user })
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Fehler beim Aktualisieren des Profils')
    }
  },

  uploadAvatar: async (file) => {
    const formData = new FormData()
    formData.append('avatar', file)
    const data = await authApi.uploadAvatar(formData)
    set(state => ({ user: { ...state.user, avatar_url: data.avatar_url } }))
    return data
  },

  deleteAvatar: async () => {
    await authApi.deleteAvatar()
    set(state => ({ user: { ...state.user, avatar_url: null } }))
  },
}))
