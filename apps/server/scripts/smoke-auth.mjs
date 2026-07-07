/**
 * Smoke test — hits a REALLY running server (start it first: `npm run dev` in apps/server).
 * Flow: register(random email) → assert shape → login → assert same → GET /me (Bearer) → assert.
 * Also verifies cross-org isolation at the API level: a second org's /me never sees the first org.
 *
 * Contract checked (API_CONTRACT §1):
 *   register/login → {token, user:{id,email,displayName}, org:{id,name}}
 *   me            → {user, org, role:'owner'|'admin'|'member'}
 *
 * NOTE: requires @meetcopilot/crm to export createCrmCore (A2). Until then the server won't boot and
 * this script will fail on connect — that's expected pre-integration (A5).
 *
 * Usage: BASE=http://localhost:8787 node scripts/smoke-auth.mjs
 */
const BASE = process.env.BASE ?? "http://localhost:8787";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

function rand() {
  return Math.random().toString(36).slice(2, 10);
}

async function registerOrg(tag) {
  // Server normalizes emails to lowercase; keep the generated email lowercase so shape asserts match.
  const email = `smoke_${tag.toLowerCase()}_${rand()}@example.com`;
  const password = "hunter2hunter2";
  const displayName = `Smoke ${tag}`;
  const orgName = `Org ${tag} ${rand()}`;

  const r = await req("POST", "/api/auth/register", {
    body: { email, password, displayName, orgName },
  });
  assert(r.status === 201, `register status 201 (got ${r.status}: ${JSON.stringify(r.json)})`);
  assert(typeof r.json?.token === "string", "register returns token");
  assert(r.json?.user?.email === email, "register user.email matches");
  assert(r.json?.user?.displayName === displayName, "register user.displayName matches");
  assert(typeof r.json?.user?.id === "string", "register user.id present");
  assert(r.json?.org?.name === orgName, "register org.name matches");
  assert(typeof r.json?.org?.id === "string", "register org.id present");
  return { email, password, displayName, orgName, ...r.json };
}

async function main() {
  // health
  const h = await req("GET", "/api/health");
  assert(h.status === 200 && h.json?.ok === true, "health ok");

  // register org A
  const a = await registerOrg("A");

  // duplicate email → 409
  const dup = await req("POST", "/api/auth/register", {
    body: { email: a.email, password: "hunter2hunter2", displayName: "dup", orgName: "dup org" },
  });
  assert(dup.status === 409, `duplicate email → 409 (got ${dup.status})`);

  // login A
  const login = await req("POST", "/api/auth/login", {
    body: { email: a.email, password: a.password },
  });
  assert(login.status === 200, `login status 200 (got ${login.status})`);
  assert(login.json?.user?.email === a.email, "login user matches");
  assert(login.json?.org?.id === a.org.id, "login org matches register org");

  // bad password → 401
  const bad = await req("POST", "/api/auth/login", {
    body: { email: a.email, password: "wrongpassword" },
  });
  assert(bad.status === 401, `bad password → 401 (got ${bad.status})`);

  // me (A)
  const meA = await req("GET", "/api/auth/me", { token: login.json.token });
  assert(meA.status === 200, `me status 200 (got ${meA.status})`);
  assert(meA.json?.user?.id === a.user.id, "me user.id matches");
  assert(meA.json?.org?.id === a.org.id, "me org.id matches");
  assert(meA.json?.role === "owner", "me role is owner");

  // no token → 401
  const noTok = await req("GET", "/api/auth/me");
  assert(noTok.status === 401, `me without token → 401 (got ${noTok.status})`);

  // cross-org isolation: register org B, its /me must be its own org, never A's
  const b = await registerOrg("B");
  const meB = await req("GET", "/api/auth/me", { token: b.token });
  assert(meB.json?.org?.id === b.org.id, "org B me sees org B");
  assert(meB.json?.org?.id !== a.org.id, "org B me does NOT see org A");

  console.log("SMOKE OK: register/login/me + duplicate/badpw/no-token + cross-org isolation all passed");
}

main().catch((err) => {
  console.error("SMOKE ERROR:", err);
  process.exit(1);
});
