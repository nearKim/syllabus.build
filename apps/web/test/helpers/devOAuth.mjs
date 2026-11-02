import assert from "node:assert/strict";

function saveCookies(response, jar) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const at = pair.indexOf("=");
    if (at < 1) continue;
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
}

export function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function backendSessionResponse(accountId, roles = ["user"]) {
  return new Response(JSON.stringify({
    account_id: accountId,
    roles,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  }), { status: 200 });
}

export async function signInWithDevOAuth(baseUrl, jar, email, provider = "google") {
  const start = await fetch(`${baseUrl}/auth/oauth/${provider}`, {
    redirect: "manual",
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(start.status, 302);
  saveCookies(start, jar);
  const authorize = new URL(start.headers.get("location"));
  const approved = await fetch(`${baseUrl}/auth/dev-idp/${provider}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", Cookie: cookieHeader(jar) },
    body: new URLSearchParams({
      redirect_uri: authorize.searchParams.get("redirect_uri"),
      state: authorize.searchParams.get("state"),
      code_challenge: authorize.searchParams.get("code_challenge"),
      email,
    }),
  });
  assert.equal(approved.status, 302);
  const callback = await fetch(approved.headers.get("location"), {
    redirect: "manual",
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(callback.status, 302);
  saveCookies(callback, jar);
  return callback;
}
