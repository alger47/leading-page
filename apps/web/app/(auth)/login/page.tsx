import { redirect } from 'next/navigation';
import { requireServerUser } from '@/lib/auth/server';
import { LoginForm } from '@/components/login-form';

export default async function LoginPage() {
  try {
    await requireServerUser();
    redirect('/dashboard');
  } catch {
    return <LoginForm />;
  }
}