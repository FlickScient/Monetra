import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MoneTra',
    short_name: 'MoneTra',
    description: 'A calm, clear home for your money.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f8f6',
    theme_color: '#0f766e',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
