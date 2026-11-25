if (window.tailwind) tailwind.config = {
      theme: {
        extend: {
          colors: {
            navy: {
              950: '#081838',
              900: '#0d244f',
              800: '#163a78',
              700: '#1e4b99',
              600: '#2563eb'
            },
            ice: {
              50: '#f8fafd',
              100: '#f5f7fb',
              200: '#e8eef7'
            },
            gold: {
              400: '#d8b058',
              500: '#c89b3c',
              600: '#a97e26'
            }
          },
          fontFamily: {
            sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
            serif: ['Merriweather', 'Georgia', 'serif']
          },
          boxShadow: {
            academic: '0 10px 30px -12px rgba(13, 36, 79, 0.12)',
            card: '0 4px 20px -4px rgba(13, 36, 79, 0.07)'
          }
        }
      }
    };
