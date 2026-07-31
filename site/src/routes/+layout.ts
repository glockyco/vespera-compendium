export const prerender = true;

/**
 * Every internal link is written with a trailing slash, so pages are emitted as `items/index.html`
 * rather than `items.html`. That makes the directory URL canonical instead of relying on the host to
 * rewrite it, and keeps relative asset paths inside a page stable.
 */
export const trailingSlash = "always";
