import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createSyllabusWebAppController } from "../src/index.ts";
import { createWebAppServer } from "../src/server.mjs";

function parseCookies(res, jar = new Map()) {
  const setCookies = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  for (const raw of setCookies) {
    const first = raw.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const key = first.slice(0, eq).trim();
    const val = first.slice(eq + 1).trim();
    if (!val || raw.includes("Max-Age=0")) jar.delete(key);
    else jar.set(key, val);
  }
  return jar;
}

function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

function cborHead(major, len) {
  if (len < 24) return Buffer.from([(major << 5) | len]);
  if (len < 256) return Buffer.from([(major << 5) | 24, len]);
  const b = Buffer.alloc(3);
  b[0] = (major << 5) | 25;
  b.writeUInt16BE(len, 1);
  return b;
}

function cborBytes(buf) {
  return Buffer.concat([cborHead(2, buf.length), buf]);
}

function cborText(str) {
  const buf = Buffer.from(str, "utf8");
  return Buffer.concat([cborHead(3, buf.length), buf]);
}

// Encodes COSE_Key for EC2 P-256 ES256: { 1: 2, 3: -7, -1: 1, -2: x, -3: y }
function encodeCoseEc2P256PublicKey(xBuf, yBuf) {
  return Buffer.concat([
    Buffer.from([0xa5]), // map(5)
    Buffer.from([0x01, 0x02]), // 1 (kty): 2 (EC2)
    Buffer.from([0x03, 0x26]), // 3 (alg): -7 (ES256)
    Buffer.from([0x20, 0x01]), // -1 (crv): 1 (P-256)
    Buffer.from([0x21]), cborBytes(xBuf), // -2 (x): bstr(32)
    Buffer.from([0x22]), cborBytes(yBuf), // -3 (y): bstr(32)
  ]);
}

// Encodes WebAuthn "none" attestationObject: { "fmt": "none", "attStmt": {}, "authData": bstr }
function encodeNoneAttestationObject(authData) {
  return Buffer.concat([
    Buffer.from([0xa3]), // map(3)
    cborText("fmt"), cborText("none"),
    cborText("attStmt"), Buffer.from([0xa0]), // map(0)
    cborText("authData"), cborBytes(authData),
  ]);
}

function uuidToBytes(uuid) {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

function createSyntheticWebAuthnAuthenticator({ rpId, origin, aaguid = "fbfc3007-154e-4ecc-8c0b-6e020557d7bd" }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const xBuf = Buffer.from(jwk.x, "base64url");
  const yBuf = Buffer.from(jwk.y, "base64url");
  const cosePublicKey = encodeCoseEc2P256PublicKey(xBuf, yBuf);
  const credentialIdBytes = crypto.randomBytes(32);
  const credentialId = credentialIdBytes.toString("base64url");
  const rpIdHash = crypto.createHash("sha256").update(rpId, "utf8").digest();

  return {
    credentialId,
    buildAttestation(challenge, { counter = 0, backedUp = true, userVerified = false } = {}) {
      // Flags: UP (0x01) | UV (0x04 optional) | BE (0x08) | BS (0x10) | AT (0x40)
      const flags = 0x01 | (userVerified ? 0x04 : 0) | 0x08 | (backedUp ? 0x10 : 0) | 0x40;
      const counterBuf = Buffer.alloc(4);
      counterBuf.writeUInt32BE(counter, 0);
      const credLenBuf = Buffer.alloc(2);
      credLenBuf.writeUInt16BE(credentialIdBytes.length, 0);

      const authData = Buffer.concat([
        rpIdHash,
        Buffer.from([flags]),
        counterBuf,
        uuidToBytes(aaguid),
        credLenBuf,
        credentialIdBytes,
        cosePublicKey,
      ]);

      const clientDataJSON = Buffer.from(
        JSON.stringify({ type: "webauthn.create", challenge, origin, crossOrigin: false }),
        "utf8",
      );
      const attestationObject = encodeNoneAttestationObject(authData);

      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientDataJSON.toString("base64url"),
          attestationObject: attestationObject.toString("base64url"),
          transports: ["internal", "hybrid"],
        },
      };
    },
    buildAssertion(challenge, { counter = 1, backedUp = true, userVerified = false, userHandle = undefined } = {}) {
      // Flags: UP (0x01) | UV (0x04 optional) | BE (0x08) | BS (0x10)
      const flags = 0x01 | (userVerified ? 0x04 : 0) | 0x08 | (backedUp ? 0x10 : 0);
      const counterBuf = Buffer.alloc(4);
      counterBuf.writeUInt32BE(counter, 0);
      const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), counterBuf]);

      const clientDataJSON = Buffer.from(
        JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }),
        "utf8",
      );
      const clientDataHash = crypto.createHash("sha256").update(clientDataJSON).digest();
      const signedBase = Buffer.concat([authData, clientDataHash]);
      const signature = crypto.sign("sha256", signedBase, privateKey);

      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          authenticatorData: authData.toString("base64url"),
          clientDataJSON: clientDataJSON.toString("base64url"),
          signature: signature.toString("base64url"),
          ...(userHandle ? { userHandle: Buffer.from(userHandle, "utf8").toString("base64url") } : {}),
        },
      };
    },
  };
}

test("Brand logo assets, favicon, webauthn-polyfills bundle, and Conditional UI autocomplete render cleanly", async () => {
  const app = createSyllabusWebAppController({ authStatus: "guest", topLevel: "Explore" });
  app.openDialog("dialog-auth", "login");
  const loginHtml = app.renderHtml();
  assert.ok(loginHtml.includes('autocomplete="username webauthn"'), "login email input exposes webauthn conditional autofill");
  assert.ok(loginHtml.includes('class="brand-mark-svg"'), "BrandLockup renders Pathway S vector mark");

  app.applyUiAction("switch-auth-mode", { authMode: "signup" });
  const signupHtml = app.renderHtml();
  assert.ok(signupHtml.includes('id="auth-email-input" type="email" name="email" autocomplete="username"'));

  const { server } = createWebAppServer({
    initialState: { authStatus: "guest", topLevel: "Explore" },
    env: { APP_ENV: "development" },
    apiBaseUrl: "http://127.0.0.1:9",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const favRes = await fetch(`${baseUrl}/favicon.svg`);
    assert.equal(favRes.status, 200);
    assert.match(favRes.headers.get("content-type") ?? "", /image\/svg\+xml/);
    const favSvg = await favRes.text();
    assert.ok(favSvg.includes('viewBox="0 0 32 32"'));

    const touchRes = await fetch(`${baseUrl}/apple-touch-icon.png`);
    assert.equal(touchRes.status, 200);
    assert.equal(touchRes.headers.get("content-type"), "image/png");
    const touchBytes = Buffer.from(await touchRes.arrayBuffer());
    assert.equal(touchBytes.subarray(0, 4).toString("hex"), "89504e47", "valid PNG header");

    const polyRes = await fetch(`${baseUrl}/vendor/webauthn-polyfills.js`);
    assert.equal(polyRes.status, 200);
    const polyJs = await polyRes.text();
    assert.ok(polyJs.includes("parseCreationOptionsFromJSON"));

    const clientRes = await fetch(`${baseUrl}/client.js`);
    const clientJs = await clientRes.text();
    assert.ok(clientJs.includes('import "/vendor/webauthn-polyfills.js";'));
    assert.ok(clientJs.includes("PublicKeyCredential.getClientCapabilities()"));
    assert.ok(clientJs.includes("PublicKeyCredential.signalUnknownCredential"));
    assert.ok(clientJs.includes('mediation: "conditional"'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("End-to-end FIDO2 WebAuthn passkey registration, exclusion, Settings management, discoverable login, and 404 signal status", async () => {
  const { server } = createWebAppServer({
    initialState: { authStatus: "guest", topLevel: "Explore" },
    env: { APP_ENV: "development" },
    apiBaseUrl: "http://127.0.0.1:9",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const webAuthnOrigin = `http://localhost:${port}`;
  const ownerJar = new Map();

  try {
    // 0. Reject bare IP origin (127.0.0.1) with helpful localhostOrigin redirect metadata
    const ipOriginRes = await fetch(`${baseUrl}/auth/passkey/login/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}",
    });
    assert.equal(ipOriginRes.status, 400);
    const ipOriginErr = await ipOriginRes.json();
    assert.equal(ipOriginErr.localhostOrigin, webAuthnOrigin);

    // 1. Unauthenticated passkey registration is rejected with 401
    const unauthReg = await fetch(`${baseUrl}/auth/passkey/register/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: webAuthnOrigin },
      body: "{}",
    });
    assert.equal(unauthReg.status, 401);

    // 2. Sign up Maya Lin via email/password
    const homeRes = await fetch(`${baseUrl}/`);
    parseCookies(homeRes, ownerJar);

    const postUi = async (jar, body) => {
      const res = await fetch(`${baseUrl}/api/ui-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar) },
        body: JSON.stringify(body),
      });
      return res.json();
    };

    const signup = await postUi(ownerJar, {
      action: "submit-sign-up",
      email: "maya@syllabus.so",
      password: "MayaPasskeyPassword!",
    });
    assert.equal(signup.state.authStatus, "authenticated");
    assert.equal(signup.state.account.username, "maya");
    const mayaAccountId = signup.state.account.accountId;

    // 3. Request registration options (Settings management flow vs promotion flow)
    const promoOptRes = await fetch(`${baseUrl}/auth/passkey/register/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(ownerJar), Origin: webAuthnOrigin },
      body: JSON.stringify({ promotion: true }),
    });
    assert.equal(promoOptRes.status, 200);
    const promoOptJson = await promoOptRes.json();
    assert.equal(promoOptJson.options.authenticatorSelection.authenticatorAttachment, "platform");

    const regOptRes = await fetch(`${baseUrl}/auth/passkey/register/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(ownerJar), Origin: webAuthnOrigin },
      body: JSON.stringify({ promotion: false }),
    });
    assert.equal(regOptRes.status, 200);
    const { options: regOptions, rpId } = await regOptRes.json();
    assert.equal(rpId, "localhost");
    assert.equal(regOptions.rp.id, "localhost");
    assert.equal(regOptions.authenticatorSelection.residentKey, "required");
    assert.equal(regOptions.authenticatorSelection.requireResidentKey, true);
    assert.equal(regOptions.authenticatorSelection.userVerification, "preferred");
    assert.equal(regOptions.authenticatorSelection.authenticatorAttachment, undefined);

    // 4. Create real ES256 attestation without UV (verifies requireUserVerification: false honors "preferred")
    const authenticator = createSyntheticWebAuthnAuthenticator({
      rpId: "localhost",
      origin: webAuthnOrigin,
      aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
    });
    const attestation = authenticator.buildAttestation(regOptions.challenge, {
      counter: 0,
      backedUp: true,
      userVerified: false,
    });

    const regVerifyRes = await fetch(`${baseUrl}/auth/passkey/register/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(ownerJar), Origin: webAuthnOrigin },
      body: JSON.stringify(attestation),
    });
    assert.equal(regVerifyRes.status, 200);
    const regVerified = await regVerifyRes.json();
    assert.equal(regVerified.verified, true);
    assert.equal(regVerified.credential.id, authenticator.credentialId);
    assert.equal(regVerified.credential.name, "iCloud Keychain");
    assert.equal(regVerified.credential.credentialDeviceType, "multiDevice");
    assert.equal(regVerified.credential.credentialBackedUp, true);

    // Settings UI renders the newly registered passkey
    const settingsPayload = await postUi(ownerJar, { action: "navigate-top", destination: "Settings" });
    assert.ok(settingsPayload.html.includes('id="settings-passkeys"'));
    assert.ok(settingsPayload.html.includes("iCloud Keychain"));
    assert.ok(settingsPayload.html.includes("Synced across devices"));
    assert.ok(settingsPayload.html.includes(`data-action="delete-passkey" data-credential-id="${authenticator.credentialId}"`));

    // Subsequent registration options exclude the already-registered credential
    const regOpt2Res = await fetch(`${baseUrl}/auth/passkey/register/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(ownerJar), Origin: webAuthnOrigin },
      body: "{}",
    });
    const regOpt2 = await regOpt2Res.json();
    assert.equal(regOpt2.options.excludeCredentials.length, 1);
    assert.equal(regOpt2.options.excludeCredentials[0].id, authenticator.credentialId);

    // 5. Fresh guest browser session: discoverable passkey authentication (no email entered!)
    const guestJar = new Map();
    const guestInit = await fetch(`${baseUrl}/`);
    parseCookies(guestInit, guestJar);

    // 5a. Unknown credential returns explicit HTTP 404 for PublicKeyCredential.signalUnknownCredential
    const authOptUnknownRes = await fetch(`${baseUrl}/auth/passkey/login/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar), Origin: webAuthnOrigin },
      body: "{}",
    });
    const authOptUnknown = await authOptUnknownRes.json();
    assert.deepEqual(authOptUnknown.options.allowCredentials, []);
    assert.equal(authOptUnknown.options.userVerification, "preferred");

    const unknownAuth = createSyntheticWebAuthnAuthenticator({ rpId: "localhost", origin: webAuthnOrigin });
    const unknownVerifyRes = await fetch(`${baseUrl}/auth/passkey/login/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar), Origin: webAuthnOrigin },
      body: JSON.stringify(unknownAuth.buildAssertion(authOptUnknown.options.challenge)),
    });
    assert.equal(unknownVerifyRes.status, 404, "unknown passkey returns HTTP 404 to trigger signalUnknownCredential");

    // 5b. Valid assertion signs Maya Lin into the guest session
    const authOptRes = await fetch(`${baseUrl}/auth/passkey/login/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar), Origin: webAuthnOrigin },
      body: "{}",
    });
    const { options: authOptions } = await authOptRes.json();
    const assertion = authenticator.buildAssertion(authOptions.challenge, {
      counter: 1,
      backedUp: true,
      userVerified: false,
      userHandle: mayaAccountId,
    });

    const loginVerifyRes = await fetch(`${baseUrl}/auth/passkey/login/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar), Origin: webAuthnOrigin },
      body: JSON.stringify(assertion),
    });
    assert.equal(loginVerifyRes.status, 200);
    const loginVerified = await loginVerifyRes.json();
    assert.equal(loginVerified.verified, true);
    assert.equal(loginVerified.state.authStatus, "authenticated");
    assert.equal(loginVerified.state.account.accountId, mayaAccountId);
    assert.equal(loginVerified.state.account.email, "maya@syllabus.so");
    assert.equal(loginVerified.state.account.username, "maya");
    assert.equal(loginVerified.state.passkeys.length, 1);
    assert.ok(loginVerified.state.passkeys[0].lastUsedAt > 0);

    // 6. Remove passkey in Settings -> subsequent login with removed passkey returns 404
    const afterDelete = await postUi(guestJar, {
      action: "delete-passkey",
      credentialId: authenticator.credentialId,
    });
    assert.equal(afterDelete.state.passkeys.length, 0);

    await postUi(guestJar, { action: "sign-out" });
    const postDeleteOpt = await (
      await fetch(`${baseUrl}/auth/passkey/login/options`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar), Origin: webAuthnOrigin },
        body: "{}",
      })
    ).json();
    const postDeleteVerify = await fetch(`${baseUrl}/auth/passkey/login/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar), Origin: webAuthnOrigin },
      body: JSON.stringify(authenticator.buildAssertion(postDeleteOpt.options.challenge, { counter: 2 })),
    });
    assert.equal(postDeleteVerify.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
