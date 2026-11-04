export interface Post {
  title: string;
  slug: string;
}

const MAX_SLUG_LENGTH = 80;

/**
 * Turn a title into a URL slug: strip accents, keep letters and digits,
 * collapse everything else into single hyphens, and cap the length.
 */
export function slugify(title: string): string {
  const ascii = title.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= MAX_SLUG_LENGTH) {
    return slug;
  }
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
}

export function createPost(title: string): Post {
  return { title, slug: slugify(title) };
}
