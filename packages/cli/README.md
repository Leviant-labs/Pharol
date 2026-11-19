# Pharol CLI

Standalone metasearch for Node.js 20.18.1+. Requires neither Next.js nor a Pharol server. Keep npm optional dependencies enabled: `impit` uses a platform-native binary. The `PHAROL_WEB_TRANSPORT=fetch` setting uses ordinary fetch instead of the default impersonating transport on supported installs.

```sh
npm install -g ./leviant-labs-pharol-cli-0.1.1.tgz
pharol search --json --engines bing,duckduckgo "public transport in Lisbon"
pharol read --json https://en.wikipedia.org/wiki/Lisbon
```

Use `pharol --help` for options. Provider keys are optional and read from environment variables such as `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, and `KEENABLE_API_KEY`. `--json` writes one response to stdout. Search can return partial or empty results; inspect `engineHealth`. Reader output uses the same format as the web preview, including fields such as `extractor`, `isFallback`, and `accessBlocked` when available. For plain text, omit `--json`. Use only public URLs with `read`, because it may send the URL to an external extraction provider. Usage errors exit 2, and command failures exit 1.

This tarball does not include a standalone MCP server. It includes the TypeScript used to build the CLI, the build configuration, and the SearXNG and Paper Search license notices. In an extracted package, `npm install --include=dev` followed by `npm run build` rebuilds the binary from the included source.
