const url = process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminPassword = process.env.PW_TEST_PASSWORD;
const limitedPassword = process.env.PW_LIMITED_PASSWORD;

const required = {
  PUBLIC_SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  PW_TEST_PASSWORD: adminPassword,
  PW_LIMITED_PASSWORD: limitedPassword,
};

const missing = Object.entries(required)
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  'content-type': 'application/json',
};

async function adminRequest(path, init = {}) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`${url}/auth/v1/admin${path}`, {
        ...init,
        headers: { ...headers, ...init.headers },
      });

      if (response.ok) {
        return response.status === 204 ? null : response.json();
      }

      const detail = (await response.text()).slice(0, 500);
      if (response.status < 500 || attempt === 5) {
        throw new Error(
          `Auth Admin API ${init.method ?? 'GET'} ${path} failed (${response.status}): ${detail}`,
        );
      }
    } catch (error) {
      if (attempt === 5) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }

  throw new Error(`Auth Admin API ${init.method ?? 'GET'} ${path} exhausted retries`);
}

async function findUser(email) {
  for (let page = 1; page <= 20; page += 1) {
    const result = await adminRequest(`/users?page=${page}&per_page=100`);
    const users = Array.isArray(result) ? result : (result.users ?? []);
    const match = users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (users.length < 100) return null;
  }
  throw new Error('Auth user lookup exceeded the 2,000-user safety limit');
}

async function ensureUser({ email, password, fullName }) {
  const existing = await findUser(email);
  const body = JSON.stringify({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, fixture: 'hour-staging' },
  });

  if (existing) {
    await adminRequest(`/users/${existing.id}`, { method: 'PUT', body });
    return 'updated';
  }

  await adminRequest('/users', { method: 'POST', body });
  return 'created';
}

for (const fixture of [
  {
    email: 'playwright@hour.test',
    password: adminPassword,
    fullName: 'Playwright Staging Admin',
  },
  {
    email: 'limited@hour.test',
    password: limitedPassword,
    fullName: 'Limited Staging Performer',
  },
]) {
  const action = await ensureUser(fixture);
  console.log(`${fixture.email}: ${action}`);
}
