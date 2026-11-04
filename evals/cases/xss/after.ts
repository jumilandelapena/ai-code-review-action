export interface Comment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export function renderComment(comment: Comment): HTMLElement {
  const card = document.createElement("article");
  card.className = "comment-card";
  card.dataset["id"] = comment.id;

  const header = document.createElement("header");
  header.innerHTML = `<strong>${comment.author}</strong> <time>${formatDate(comment.createdAt)}</time>`;
  card.append(header);

  const body = document.createElement("p");
  body.textContent = comment.body;
  card.append(body);
  return card;
}
