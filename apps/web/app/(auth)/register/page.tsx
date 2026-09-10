import { redirect } from 'next/navigation';
import { requireServerUser } from '@/lib/auth/server';
import { RegisterForm } from '@/components/register-form';

export default async function RegisterPage() {
  try {
    await requireServerUser();
    redirect('/dashboard');
  } catch {
    return <RegisterForm />;
  }
}