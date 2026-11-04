export interface Post {
  title: string;
  slug: string;
}

export function createPost(title: string): Post {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return { title, slug };
}
