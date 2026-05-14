import NextAuth from 'next-auth';
import GithubProvider from 'next-auth/providers/github';

export const authOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const allowed = (process.env.ADMIN_GITHUB_LOGIN || '').split(',').map(s => s.trim());
      return allowed.includes(profile.login);
    },
    async session({ session, token }) {
      session.user.login = token.login;
      return session;
    },
    async jwt({ token, profile }) {
      if (profile) token.login = profile.login;
      return token;
    },
  },
  pages: {
    signIn: '/admin/login',
    error: '/admin/login',
  },
};

export default NextAuth(authOptions);
