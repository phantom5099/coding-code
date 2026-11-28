import * as HttpRouter from '@effect/platform/HttpRouter';
import * as HttpServerResponse from '@effect/platform/HttpServerResponse';
import { Effect } from 'effect';
import { AgentError } from '@codingcode/util';
import {
  assertAssetName,
  assetsDirOf,
  mimeTypeFromAssetName,
  readAsset,
} from '@codingcode/session';
import { resolveCwd } from '../cwd.js';
import { pathParams, query, type Handler, type Router } from '../handler.js';

const getAsset: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const { cwd } = yield* query;
  const assetName = name ?? '';
  const dir = assetsDirOf(resolveCwd(cwd));

  yield* Effect.try({
    try: () => assertAssetName(assetName),
    catch: (e) => (e instanceof AgentError ? e : AgentError.invalidInput(String(e))),
  });

  const bytes = yield* Effect.try({
    try: () => readAsset({ dir, name: assetName }),
    catch: (e) => new AgentError('SESSION_IO_ERROR', `Failed to read asset: ${String(e)}`),
  });

  return HttpServerResponse.uint8Array(bytes, {
    contentType: mimeTypeFromAssetName(assetName),
    headers: { 'cache-control': 'public, max-age=31536000, immutable' },
  });
});

export const addAssetsRoutes = (router: Router): Router =>
  router.pipe(HttpRouter.get('/api/assets/:name', getAsset));
