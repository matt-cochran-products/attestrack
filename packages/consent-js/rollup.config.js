import typescript from '@rollup/plugin-typescript'

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/consent.js',
    format: 'iife',
    name: 'AttestrackConsent',
    sourcemap: true
  },
  plugins: [typescript({ tsconfig: './tsconfig.json' })]
}
