# SearXNG-derived engine adapters

`lib/web-engines.ts` adapts the request parameters, HTML selectors, redirect
decoding, CAPTCHA detection and DuckDuckGo pagination flow from SearXNG:

- https://github.com/searxng/searxng/blob/b99cf7496eeb837e4c60a17eacaa60fe946fc4e4/searx/engines/google.py
- https://github.com/searxng/searxng/blob/b99cf7496eeb837e4c60a17eacaa60fe946fc4e4/searx/engines/bing.py
- https://github.com/searxng/searxng/blob/b99cf7496eeb837e4c60a17eacaa60fe946fc4e4/searx/engines/duckduckgo.py

Copyright: SearXNG contributors. Licensed under GNU Affero General Public
License version 3 or later; see LICENSE in this directory. The TypeScript
adaptation is distributed under the same terms. Deploying the combined work
must comply with applicable AGPL terms, including network source availability.

Changes: translated to TypeScript/Cheerio; uses Pharol's supported region
profiles, in-memory bounded pagination-token cache and health reporting.
Transport uses the separately packaged Apache-2.0 `impit` library for native
Chrome/Firefox TLS and HTTP impersonation, rather than SearXNG's curl_cffi
implementation. Proxy pools and dynamically downloaded language traits are
not ported. Engine blocking remains dependent on the deployment's IP and transport.
