import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import './fonts.css'
import { createVuetify } from 'vuetify'

/**
 * The design's look: low-saturation neutrals with one indigo, Material components (outlined
 * inputs, flat bordered cards, chips, dialogs).
 */
export const vuetify = createVuetify({
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        colors: {
          background: '#F4F5F7',
          surface: '#FFFFFF',
          'on-background': '#16191F',
          'on-surface': '#16191F',
          primary: '#2F55D4',
          'primary-darken-1': '#2443B0',
          /** Role chips, the user's avatar, selected rows. */
          'primary-soft': '#E8EDFC',
          secondary: '#8FA8F5',
          info: '#2F55D4',
          /** Added (green), changed (amber), deleted / data loss (red). */
          success: '#2E9A62',
          warning: '#D99A00',
          error: '#C62F2F',
        },
        variables: {
          'border-color': '#16191F',
          'border-opacity': 0.12,
          'medium-emphasis-opacity': 0.72,
        },
      },
    },
  },
  defaults: {
    VBtn: { variant: 'flat', rounded: 'md', class: 'text-none' },
    VCard: { flat: true, border: true, rounded: 'lg' },
    VTextField: { variant: 'outlined', density: 'comfortable', color: 'primary' },
    VTextarea: { variant: 'outlined', density: 'comfortable', color: 'primary' },
    VSelect: { variant: 'outlined', density: 'comfortable', color: 'primary' },
    VAutocomplete: { variant: 'outlined', density: 'comfortable', color: 'primary' },
    VCheckbox: { color: 'primary', density: 'comfortable' },
    VChip: { size: 'small', variant: 'tonal' },
    VDialog: { maxWidth: 560 },
  },
})
