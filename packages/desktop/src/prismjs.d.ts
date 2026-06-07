declare module 'prismjs' {
  const Prism: {
    highlightElement: (element: Element) => void;
    languages: Record<string, unknown>;
  };
  export default Prism;
}
