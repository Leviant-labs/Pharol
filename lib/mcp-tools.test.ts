import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEARX_MCP_SERVER_INFO,
  SEARX_MCP_TOOLS,
  buildJsonRpcSuccess,
  buildJsonRpcError,
} from './mcp-tools';

test('SEARX_MCP_SERVER_INFO defines valid MCP server metadata', () => {
  assert.equal(SEARX_MCP_SERVER_INFO.name, 'pharol-mcp');
  assert.ok(SEARX_MCP_SERVER_INFO.version.length > 0);
});

test('SEARX_MCP_TOOLS exposes all 6 core tools with valid JSON Schema objects', () => {
  const names = SEARX_MCP_TOOLS.map((t) => t.name);
  assert.deepEqual(names, [
    'web_search',
    'news_search',
    'academic_search',
    'read_webpage',
    'suggest_queries',
    'get_weather',
  ]);

  for (const tool of SEARX_MCP_TOOLS) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(Object.keys(tool.inputSchema.properties).length > 0);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
  }
});

test('buildJsonRpcSuccess and buildJsonRpcError construct compliant JSON-RPC 2.0 envelopes', () => {
  const ok = buildJsonRpcSuccess(42, { tools: [] });
  assert.deepEqual(ok, {
    jsonrpc: '2.0',
    id: 42,
    result: { tools: [] },
  });

  const err = buildJsonRpcError('req-1', -32602, 'Invalid params');
  assert.deepEqual(err, {
    jsonrpc: '2.0',
    id: 'req-1',
    error: { code: -32602, message: 'Invalid params' },
  });
});
