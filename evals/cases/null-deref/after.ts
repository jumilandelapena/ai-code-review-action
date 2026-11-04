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

const WELCOME_SUBJECT = "Welcome aboard";

function welcomeBody(name: string): string {
  return `Hi ${name},\n\nThanks for signing up. Reply to this email if you need anything.`;
}

export async function onSignup(user: User, mailer: Mailer): Promise<void> {
  console.log(`new user ${user.id}`);
  const name = user.profile?.displayName ?? "there";
  await mailer.send(user.profile.email, WELCOME_SUBJECT, welcomeBody(name));
}
