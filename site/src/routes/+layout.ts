export const prerender = true;

/**
 * Writes a trailing slash on each internal link.
 * Pages then emit as `items/index.html` instead of `items.html`.
 * The directory URL stays canonical and relative asset paths stay stable.
 */
export const trailingSlash = "always";
