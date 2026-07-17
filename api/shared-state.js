const STATE_KEY = process.env.SHARED_STATE_KEY || "web-production-gantt:shared-state";
const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  "913052066974-1sdbg5mrjl009h7vnnujcsgpgjinqae2.apps.googleusercontent.com";
const ALLOWED_DOMAINS = (process.env.ALLOWED_GOOGLE_DOMAINS || "sooon-web.com")
  .split(",")
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);

function redisConfig() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "",
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || ""
  };
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) {
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function emailDomain(email) {
  return normalizeEmail(email).split("@")[1] || "";
}

async function verifyGoogleToken(request) {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    const error = new Error("Missing authorization token");
    error.status = 401;
    throw error;
  }

  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  if (!response.ok) {
    const error = new Error("Invalid Google token");
    error.status = 401;
    throw error;
  }

  const payload = await response.json();
  const email = normalizeEmail(payload.email);
  const hostedDomain = String(payload.hd || "").toLowerCase();
  const domain = emailDomain(email);
  const verified = payload.email_verified === true || payload.email_verified === "true";

  if (payload.aud !== GOOGLE_CLIENT_ID || !verified) {
    const error = new Error("Google token is not allowed");
    error.status = 403;
    throw error;
  }

  if (!ALLOWED_DOMAINS.includes(hostedDomain) && !ALLOWED_DOMAINS.includes(domain)) {
    const error = new Error("Email domain is not allowed");
    error.status = 403;
    throw error;
  }

  return { email, domain };
}

async function redisCommand(command) {
  const { url, token } = redisConfig();
  if (!url || !token) {
    const error = new Error("Shared storage is not configured");
    error.status = 503;
    throw error;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error) {
    const error = new Error(payload.error || "Shared storage request failed");
    error.status = response.status || 500;
    throw error;
  }

  return payload.result;
}

function sanitizeState(input) {
  const state = input && typeof input === "object" ? input : {};
  return {
    ...state,
    isAuthenticated: false,
    session: null,
    currentView: "login",
    sharedUpdatedAt: new Date().toISOString()
  };
}

module.exports = async function handler(request, response) {
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== "GET" && request.method !== "PUT") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const user = await verifyGoogleToken(request);

    if (request.method === "GET") {
      const value = await redisCommand(["GET", STATE_KEY]);
      sendJson(response, 200, {
        state: value ? JSON.parse(value) : null,
        user
      });
      return;
    }

    const body = await readJsonBody(request);
    const state = sanitizeState(body.state);
    await redisCommand(["SET", STATE_KEY, JSON.stringify(state)]);
    sendJson(response, 200, {
      ok: true,
      sharedUpdatedAt: state.sharedUpdatedAt,
      user
    });
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.message || "Unexpected error" });
  }
};
