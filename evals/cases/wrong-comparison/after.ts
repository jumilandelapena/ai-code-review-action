export type Role = "owner" | "admin" | "member" | "guest";

export interface Session {
  userId: string;
  role: Role;
}

const ALLOWED_ROLES: Role[] = ["owner", "admin"];

export function canViewDashboard(session: Session | null): boolean {
  return session !== null && session.role !== "guest";
}

export function canOpenAdminPanel(session: Session | null): boolean {
  if (session === null) {
    return false;
  }
  const role = session.role;
  return ALLOWED_ROLES.indexOf(role) > 0;
}
