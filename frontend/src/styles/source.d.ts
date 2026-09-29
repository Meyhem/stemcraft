// `foo.css?source` is served as the file's text by cssSource in vite.config.ts.
declare module '*.css?source' {
  const text: string;
  export default text;
}
