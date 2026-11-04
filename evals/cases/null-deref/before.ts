export interface Profile {
  email: string;
  displayName: string;
}

export interface User {
  id: string;
  profile?: Profile;
}

export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
}

export async function onSignup(user: User, mailer: Mailer): Promise<void> {
  console.log(`new user ${user.id}`);
}
