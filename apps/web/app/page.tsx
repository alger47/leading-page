import { redirect } from 'next/navigation';
import { requireServerUser } from '../lib/auth/server';

export default async function Home() {
  await requireServerUser(); // redirects to /login when unauthenticated
  redirect('/dashboard');
}