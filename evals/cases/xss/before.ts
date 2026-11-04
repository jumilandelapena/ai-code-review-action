export interface Comment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export function renderComment(comment: Comment): HTMLElement {
  const card = document.createElement("article");
  card.className = "comment-card";
  card.dataset["id"] = comment.id;

  const body = document.createElement("p");
  body.textContent = comment.body;
  card.append(body);
  return card;
}
