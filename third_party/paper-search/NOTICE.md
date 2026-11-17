# Paper Search integration

The OpenAlex work mapping, strict identifier handling, separate OA landing/PDF
links and bounded one-hop relationships adapt workflows from openags/paper-search-mcp:
https://github.com/openags/paper-search-mcp/tree/cab1b5cc276a0cd004a0044003926a6440088049

Sources: paper_search_mcp/academic_platforms/openalex.py and openalex_relations.py.
Copyright (c) 2025 OPENAGS. MIT license reproduced in LICENSE.

Changes: TypeScript implementation in lib/openalex.ts and lib/paper-tools.ts;
uses existing Pharol source adapters and MCP endpoint. No Python runtime or
separate server. Implements the listed search sources and PMC/arXiv HTML text
retrieval, not every upstream connector or arbitrary PDF downloads. No Sci-Hub
integration. Upstream provider quotas and access restrictions still apply.
