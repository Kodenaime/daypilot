/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: 'class', // supports light/dark variants using NativeWind dark: selector classes
  theme: {
    extend: {
      colors: {
        // Light & Dark specific palette tokens
        primary: {
          light: '#0066FF',
          dark: '#3D8BFF',
          DEFAULT: '#0066FF', // Default fallback
        },
        accent: {
          light: '#FF4500',
          dark: '#FF6433',
          DEFAULT: '#FF4500',
        },
        background: {
          light: '#FFFFFF',
          dark: '#0E0E10',
          DEFAULT: '#FFFFFF',
        },
        surface: {
          light: '#F7F8FA',
          dark: '#1A1A1D',
          DEFAULT: '#F7F8FA',
        },
        textPrimary: {
          light: '#1A1A1D',
          dark: '#F2F2F3',
          DEFAULT: '#1A1A1D',
        },
        textSecondary: {
          light: '#6B6B70',
          dark: '#9A9AA0',
          DEFAULT: '#6B6B70',
        },
        border: {
          light: '#E5E6E8',
          dark: '#2A2A2E',
          DEFAULT: '#E5E6E8',
        },
        success: {
          light: '#1FA75B',
          dark: '#34C97A',
          DEFAULT: '#1FA75B',
        },
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '32px',
      },
      fontFamily: {
        inter: ['Inter_400Regular', 'System'],
        interBold: ['Inter_700Bold', 'System'],
      },
    },
  },
  plugins: [],
}
