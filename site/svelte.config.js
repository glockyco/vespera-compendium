import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ pages: "build", assets: "build", fallback: undefined, strict: true }),
    // `entries: ["*"]` covers every parameterless route; the two dynamic routes supply their own
    // params through route-level `entries()`, so crawling markup is unnecessary.
    prerender: { crawl: false, entries: ["*"], handleHttpError: "fail", handleMissingId: "fail" },
  },
};

export default config;
