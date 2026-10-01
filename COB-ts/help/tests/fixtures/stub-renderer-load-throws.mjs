// QA fixture (B29-R8a, zero Mermaid blocks): importing this module is an error. A build with no Mermaid block must
// not load the renderer module at all, so it still exits 0; a build with a block must fail on it.
throw new Error('renderer module was loaded');
