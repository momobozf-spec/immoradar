import coreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

/**
 * Twee regels dragen hier het echte gewicht.
 *
 * `no-explicit-any` staat op error omdat een verkeerd getypte RawListing
 * stilzwijgend doorloopt tot in een Telegram-alert bij een makelaar.
 *
 * De import-restrictie op de rekenlagen houdt ze puur. Zodra `matching/` of
 * `scoring/` Prisma mag aanraken, is de beslislogica niet meer los te testen
 * en verhuist ze ongemerkt naar de services.
 */
const PURE_LAYERS = [
  'src/domain/**/*.ts',
  'src/normalization/**/*.ts',
  'src/matching/**/*.ts',
  'src/events/**/*.ts',
  'src/scoring/**/*.ts',
  'src/territories/**/*.ts',
  'src/crm/**/*.ts',
  'src/leadrevive/**/*.ts',
]

const eslintConfig = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**', '.devdb/**', 'src/generated/**'],
  },
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: PURE_LAYERS,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@prisma/client',
                '@/generated/prisma/*',
                '@/repositories/*',
                '@/services/*',
                '@/collectors/*',
                'next/*',
              ],
              message:
                'Deze laag rekent en praat niet met de buitenwereld. Geef data door als argument in plaats van de database of het netwerk te bevragen.',
            },
          ],
        },
      ],
    },
  },
  {
    // React-componenten renderen; ze bevragen de database niet rechtstreeks.
    files: ['src/app/**/*.tsx', 'src/components/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/generated/prisma/client',
              importNames: ['PrismaClient'],
              message:
                'Componenten instantiëren geen Prisma. Roep een service in src/services aan.',
            },
          ],
        },
      ],
    },
  },
]

export default eslintConfig
