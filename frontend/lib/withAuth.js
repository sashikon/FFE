import { getServerSession } from 'next-auth/next';
import { authOptions } from '../pages/api/auth/[...nextauth]';

export async function withAuth(ctx) {
  try {
    const session = await getServerSession(ctx.req, ctx.res, authOptions);
    if (!session) {
      return {
        redirect: { destination: '/admin/login', permanent: false },
      };
    }
    return null;
  } catch (err) {
    console.error('[withAuth] error:', err);
    return {
      redirect: { destination: '/admin/login', permanent: false },
    };
  }
}
