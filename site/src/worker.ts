/**
 * The custom domain invokes a Worker, but the site is static.
 * The edge matches assets before the Worker runs.
 * Only requests without an asset arrive here.
 * Pass those requests to the assets binding so `not_found_handling` serves the prerendered 404 page.
 */
type AssetFetcher = { fetch(request: Request): Promise<Response> };

export default {
  async fetch(request: Request, env: { ASSETS: AssetFetcher }): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
};
