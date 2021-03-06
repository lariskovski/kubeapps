import { ThunkAction } from "redux-thunk";
import { definedNamespaces } from "shared/Namespace";
import { ActionType, createAction } from "typesafe-actions";

import { Auth } from "../shared/Auth";
import { IStoreState } from "../shared/types";
import { clearClusters, fetchNamespaces, NamespaceAction } from "./namespace";

export const setAuthenticated = createAction("SET_AUTHENTICATED", resolve => {
  return (authenticated: boolean, oidc: boolean, defaultNamespace: string) =>
    resolve({ authenticated, oidc, defaultNamespace });
});

export const authenticating = createAction("AUTHENTICATING");

export const authenticationError = createAction("AUTHENTICATION_ERROR", resolve => {
  return (errorMsg: string) => resolve(errorMsg);
});

export const setSessionExpired = createAction("SET_AUTHENTICATION_SESSION_EXPIRED", resolve => {
  return (sessionExpired: boolean) => resolve({ sessionExpired });
});

const allActions = [setAuthenticated, authenticating, authenticationError, setSessionExpired];

export type AuthAction = ActionType<typeof allActions[number]>;

export function authenticate(
  cluster: string,
  token: string,
  oidc: boolean,
): ThunkAction<Promise<void>, IStoreState, null, AuthAction> {
  return async dispatch => {
    dispatch(authenticating());
    try {
      if (!oidc) {
        await Auth.validateToken(cluster, token);
      }
      Auth.setAuthToken(token, oidc);
      // TODO(andresmgot): This is a workaround while #2018 gets properly implemented.
      // If the current sa is not associated to a namespace, list all namespaces and pick
      // one.
      let ns = Auth.defaultNamespaceFromToken(token);
      if (!ns) {
        const availableNamespaces = await dispatch(fetchNamespaces(cluster));
        if (availableNamespaces.length) {
          ns = availableNamespaces[0];
        } else {
          ns = definedNamespaces.all;
        }
      }
      dispatch(setAuthenticated(true, oidc, ns));
      if (oidc) {
        dispatch(setSessionExpired(false));
      }
    } catch (e) {
      dispatch(authenticationError(e.toString()));
    }
  };
}

export function logout(): ThunkAction<
  Promise<void>,
  IStoreState,
  null,
  AuthAction | NamespaceAction
> {
  return async (dispatch, getState) => {
    // We can't do anything before calling unsetAuthCookie as otherwise the
    // state changes and the redirect to the logout URI is lost.
    if (Auth.usingOIDCToken()) {
      const { config } = getState();
      Auth.unsetAuthCookie(config);
    } else {
      Auth.unsetAuthToken();
      dispatch(setAuthenticated(false, false, ""));
      dispatch(clearClusters());
    }
  };
}

export function expireSession(): ThunkAction<Promise<void>, IStoreState, null, AuthAction> {
  return async dispatch => {
    if (Auth.usingOIDCToken()) {
      dispatch(setSessionExpired(true));
    }
    return dispatch(logout());
  };
}

export function checkCookieAuthentication(
  cluster: string,
): ThunkAction<Promise<boolean>, IStoreState, null, AuthAction> {
  return async dispatch => {
    // The call to authenticate below will also dispatch authenticating,
    // but we dispatch it early so that the login screen is shown as
    // loading while we query isAuthenticatedWithCookie().
    dispatch(authenticating());
    const isAuthed = await Auth.isAuthenticatedWithCookie(cluster);
    if (isAuthed) {
      await dispatch(authenticate(cluster, "", true));
    } else {
      dispatch(setAuthenticated(false, false, ""));
    }
    return isAuthed;
  };
}
