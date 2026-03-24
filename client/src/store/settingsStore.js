import { create } from 'zustand'
import { settingsApi } from '../api/client'

export const useSettingsStore = create((set, get) => ({
  settings: {
    map_tile_url: '',
    default_lat: 48.8566,
    default_lng: 2.3522,
    default_zoom: 10,
    dark_mode: false,
    default_currency: 'USD',
    language: localStorage.getItem('app_language') || 'en',
    temperature_unit: 'fahrenheit',
    time_format: '12h',
    show_place_description: false,
  },
  isLoaded: false,

  loadSettings: async () => {
    try {
      const data = await settingsApi.get()
      set(state => ({
        settings: { ...state.settings, ...data.settings },
        isLoaded: true,
      }))
    } catch (err) {
      set({ isLoaded: true })
      console.error('Failed to load settings:', err)
    }
  },

  updateSetting: async (key, value) => {
    set(state => ({
      settings: { ...state.settings, [key]: value }
    }))
    if (key === 'language') localStorage.setItem('app_language', value)
    try {
      await settingsApi.set(key, value)
    } catch (err) {
      console.error('Failed to save setting:', err)
      throw new Error(err.response?.data?.error || 'Error saving setting')
    }
  },

  setLanguageLocal: (lang) => {
    localStorage.setItem('app_language', lang)
    set(state => ({ settings: { ...state.settings, language: lang } }))
  },

  updateSettings: async (settingsObj) => {
    set(state => ({
      settings: { ...state.settings, ...settingsObj }
    }))
    try {
      await settingsApi.setBulk(settingsObj)
    } catch (err) {
      console.error('Failed to save settings:', err)
      throw new Error(err.response?.data?.error || 'Error saving settings')
    }
  },
}))
