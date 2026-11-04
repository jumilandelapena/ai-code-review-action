export type Role = "owner" | "admin" | "member" | "guest";

export interface Session {
  userId: string;
  role: Role;
}

export function canViewDashboard(session: Session | null): boolean {
  return session !== null && session.role !== "guest";
}
