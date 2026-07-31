/**
 * A custom domain needs a Worker to invoke, but this site is entirely static. Assets are matched at
 * the edge before the Worker runs, so only a request matching no asset arrives here, and handing it
 * straight back to the assets binding lets `not_found_handling` serve the prerendered 404 page.
 */
type AssetFetcher = { fetch(request: Request): Promise<Response> };

export default {
  async fetch(request: Request, env: { ASSETS: AssetFetcher }): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
};
