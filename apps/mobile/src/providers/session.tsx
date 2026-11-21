import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { createApi } from "@/lib/api";
import { type authClient, readCookie } from "@/lib/auth";
import { accountTwin, forgetAccount, markSignedIn, markSignedOut, rememberAccount, setServer } from "@/lib/server";

export interface SessionState {
  /** Signed in (a session from the server or SecureStore's cache). */
  signedIn: boolean;
  /** Still checking (first launch, no cache yet). */
  pending: boolean;
  user: { id: string; name: string; email: string } | null;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * The Better Auth session of the current server's client (cached in SecureStore by the Expo plugin, so a
 * signed-in person opens the app straight into it). When it ends, cached server data is dropped.
 */
export function SessionProvider({
  auth,
  server,
  children,
}: {
  auth: ReturnType<typeof authClient>;
  /**
   * The place `auth` signs in to (a server, or one of its accounts): on the list of those signed in to once a session
   * is there (ADR 0154, ADR 0183).
   */
  server: string;
  children: ReactNode;
}) {
  const session = auth.useSession();
  const queryClient = useQueryClient();
  const user = session.data?.user ?? null;
  const signedIn = Boolean(user);
  // Better Auth can expose a cached/empty atom before its first SecureStore-backed request has completed. The
  // session gate must wait for that request explicitly; otherwise a returning user briefly sees sign-in/sign-up
  // and can mistake the transient route for a lost session. A refetch on the first mount also makes this boundary
  // independent of the hook's initial atom state. Kept per client because another server has its own cookie.
  const [hydratedBy, setHydratedBy] = useState<typeof auth | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHydratedBy(null);
    void session.refetch().finally(() => {
      if (!cancelled) setHydratedBy(() => auth);
    });
    return () => {
      cancelled = true;
    };
  }, [auth, session.refetch]);
  const answered = hydratedBy === auth && !session.isPending;

  const userId = user?.id ?? null;
  const userName = user?.name ?? "";
  const userEmail = user?.email ?? "";
  useEffect(() => {
    if (!userId) return;
    // An account added on a server where this phone already has that person (ADR 0183): no second copy. This one's
    // session ends and the app goes to the place they were already in.
    const settle = () => {
      rememberAccount(server, { id: userId, name: userName, email: userEmail });
      markSignedIn(server);
    };
    const twin = accountTwin(server, userId);
    if (!twin) return settle();
    let gone = false;
    // Only while their sign-in there still answers; one that ended gives its place up to this one.
    void createApi(twin)
      .account.me()
      .then(
        (me) => me?.user.id === userId,
        () => true,
      )
      .then((alive) => {
        if (gone) return;
        if (!alive) {
          markSignedOut(twin);
          forgetAccount(twin);
          return settle();
        }
        return auth
          .signOut()
          .catch(() => {})
          .then(() => setServer(twin));
      });
    return () => {
      gone = true;
    };
  }, [auth, server, userId, userName, userEmail]);

  useEffect(() => {
    if (signedIn) {
      // Whatever was cached while signed out (e.g. `me` = null) is stale now.
      void readCookie(server).then(() => queryClient.invalidateQueries());
    } else queryClient.clear();
  }, [signedIn, queryClient, server]);

  const value = useMemo<SessionState>(
    () => ({
      signedIn,
      pending: !answered,
      user: user ? { id: user.id, name: user.name, email: user.email } : null,
      refresh: () => session.refetch(),
    }),
    [signedIn, answered, user, session.refetch],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The session gate's state (`app/_layout.tsx` sends signed-out people to `(auth)`). */
export function useSession(): SessionState {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}
