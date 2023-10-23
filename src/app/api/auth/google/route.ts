import { getServices } from '@me/lib/server/services';
import * as Auth from '@me/lib/server/auth';
import { MemberProvider } from '@me/lib/server/memberProviders/memberProvider';
import { TokenPayload } from 'google-auth-library';
import { AuthResponse } from '@me/types/authResponse'
import { AuthError } from '@me/lib/apiErrors'
import { MemberProviderType } from '@me/types/data/MemberProviderType';
import { RouteHandlerWithSession, ironSessionWrapper } from '@me/lib/server/session';
import { NextResponse } from 'next/server';

export const POST: RouteHandlerWithSession = ironSessionWrapper(async (request) => {
  let memberProvider: MemberProvider | undefined = undefined;
  let payload: TokenPayload | undefined;
  if (process.env.DEV_NETWORK_DISABLED) {
    const data = process.env.DEV_AUTH_USER ?? '{}';
    console.log('login data', data);
    payload = JSON.parse(data);
  } else {
    const { token } = await request.json();
    const authClient = (await getServices()).authClient;

    const ticket = await authClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_ID,
    });

    payload = ticket.getPayload();
  }

  if (!payload) {
    return new Response(JSON.stringify({ error: AuthError.NO_TICKET }), { status: 500 });
  }

  if (!payload.email) {
    return new Response(JSON.stringify({ error: AuthError.NO_EMAIL }), { status: 500 });
  }

  const domain = request.headers.get('host')?.split(':')[0] ?? '';


  memberProvider = (await getServices()).memberProviders.get(MemberProviderType.D4H);

  const authInfo = {
    provider: 'google',
    email: payload.email,
  };

  const memberInfo = await memberProvider.getMemberInfo(authInfo);
  if (!memberInfo) {
    return new Response(JSON.stringify({ error: AuthError.USER_NOT_KNOWN }), { status: 403 });
  }

  request.session.auth = {
    email: payload.email,
    userId: memberInfo.id,
    groups: memberInfo.groups,
    isSiteAdmin: false,
    ...payload,
  };

  console.log(`Logging in user ${payload.email}`);
  await request.session.save();

  const userInfo = Auth.userFromAuth(request.session.auth)
  const responseBody: AuthResponse = {
    userInfo,
  }

  memberProvider?.refresh();
  return NextResponse.json(responseBody);
});