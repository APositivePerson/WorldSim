interface ImportMeta { readonly env: { readonly BASE_URL: string }; }
declare module '*.wasm?url' { const url: string; export default url; }
