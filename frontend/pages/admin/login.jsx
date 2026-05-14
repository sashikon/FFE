import { signIn } from 'next-auth/react';
import { getServerSideProps as getAuthProps } from '../../lib/withAuth';

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10 text-center max-w-sm w-full">
        <h1 className="text-2xl font-serif mb-2">FFE Admin</h1>
        <p className="text-zinc-400 text-sm mb-8">Войдите через GitHub чтобы получить доступ</p>
        <button
          onClick={() => signIn('github', { callbackUrl: '/admin' })}
          className="w-full py-3 bg-zinc-100 text-zinc-900 rounded-lg font-semibold hover:bg-white transition-colors"
        >
          Войти через GitHub
        </button>
      </div>
    </div>
  );
}

export async function getServerSideProps(ctx) {
  return { props: {} };
}
