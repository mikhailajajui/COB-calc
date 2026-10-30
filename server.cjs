// Entry point for Azure App Service on Windows (docs/DEPLOY-AZURE-WINDOWS.md). iisnode loads its entry file with
// require(), which cannot load ui/serve.mjs (an ES module with top-level await), so this file imports it instead.
import('./ui/serve.mjs').catch((err) => {
  console.error(`server.cjs: cannot start ui/serve.mjs: ${err?.stack ?? err}`);
  process.exit(1);
});
