import { useState, useEffect } from 'react';
import { useAction, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

const TOKEN_KEY = 'convex_auth_token';

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY);
  });

  const signup = useAction(api.authActions.signup);
  const signin = useAction(api.authActions.signin);
  const signoutMutation = useAction(api.authActions.signout);

  const currentUser = useQuery(api.auth.getCurrentUser, token ? { token } : "skip");

  const handleSignup = async (email: string, password: string) => {
    const result = await signup({ email, password });
    setToken(result.token);
    localStorage.setItem(TOKEN_KEY, result.token);
    return result;
  };

  const handleSignin = async (email: string, password: string) => {
    const result = await signin({ email, password });
    setToken(result.token);
    localStorage.setItem(TOKEN_KEY, result.token);
    return result;
  };

  const handleSignout = async () => {
    if (token) {
      try {
        await signoutMutation({ token });
      } catch (error) {
        console.error('Signout error:', error);
      }
    }
    setToken(null);
    localStorage.removeItem(TOKEN_KEY);
  };

  // If there's no token, we're not loading - user just needs to log in
  // If there's a token, we're loading until the query resolves
  const isLoading = token ? currentUser === undefined : false;

  return {
    token,
    currentUser,
    isAuthenticated: !!currentUser,
    isLoading,
    signup: handleSignup,
    signin: handleSignin,
    signout: handleSignout,
  };
}
