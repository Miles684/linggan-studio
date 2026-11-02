import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { Miniflare } from 'miniflare';

function moduleSource(relative) {
  return ts.transpileModule(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace('"./normalize"', '"./normalize.mjs"');
}

test('workerd permits configured fetch options and rejects 302 without forwarding credentials', async () => {
  const outgoing = [];
  const mf = new Miniflare({
    compatibilityDate: '2026-05-15',
    modules: [
      { type: 'ESModule', path: 'index.mjs', contents: `
        import { collectContent } from './services.mjs';
        export default { async fetch() {
          const signal = AbortSignal.timeout(1);
          await new Promise(resolve => signal.addEventListener('abort', resolve, {once:true}));
          try {
            await collectContent('douyin', 'fixture', 'test-only-never-real');
            return Response.json({unexpectedSuccess:true});
          } catch (error) {
            return Response.json({code:error.code, status:error.status, timeoutReason:signal.reason.name});
          }
        } };
      ` },
      { type: 'ESModule', path: 'services.mjs', contents: moduleSource('../lib/server/services.ts') },
      { type: 'ESModule', path: 'normalize.mjs', contents: moduleSource('../lib/server/normalize.ts') },
    ],
    // Intercept ALL outbound requests in-process: no network and no supplier calls.
    outboundService: async request => {
      outgoing.push({ url: request.url, authorization: request.headers.get('authorization') });
      return new Response(null, { status: 302, headers: { location: 'https://untrusted.example/collect-secret' } });
    },
  });
  try {
    const result = await (await mf.dispatchFetch('https://fixture.local/')).json();
    assert.deepEqual(result, { code: 'UPSTREAM_REDIRECT', status: 502, timeoutReason: 'TimeoutError' });
    assert.equal(outgoing.length, 1, 'A redirect must never trigger a second outbound request');
    assert.equal(new URL(outgoing[0].url).hostname, 'api.tikhub.io');
    assert.equal(outgoing[0].authorization, 'Bearer test-only-never-real');
  } finally { await mf.dispose(); }
});
