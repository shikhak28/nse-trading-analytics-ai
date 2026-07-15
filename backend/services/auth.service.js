const kite = require("../config/kite");
const userService = require("./user.service");
const tokenService = require("./token.service");

/**
 * Returns Zerodha Login URL
 */
function getLoginURL() {
    const redirectUrl = process.env.KITE_REDIRECT_URL || "http://localhost:5000/auth/callback";
    const url = new URL(kite.default_login_uri || "https://kite.zerodha.com/connect/login");

    url.searchParams.set("api_key", process.env.KITE_API_KEY);
    url.searchParams.set("v", "3");
    url.searchParams.set("redirect_url", redirectUrl);

    return url.toString();
}

/**
 * Exchange request_token for access_token
 */
async function generateSession(requestToken) {
    const response = await kite.generateSession(
        requestToken,
        process.env.KITE_API_SECRET
    );

    return response;
}

async function exchangeRequestToken(requestToken) {
    const session = await generateSession(requestToken);

    const user = await userService.upsertUserFromSession(session);
    await tokenService.saveToken(user.id, session.access_token);
    kite.setAccessToken(session.access_token);

    return session;
}

/**
 * Load access token
 */
async function loadAccessToken() {
    const accessToken = await tokenService.getActiveToken();

    if (accessToken) {
        kite.setAccessToken(accessToken);
    }

    return accessToken;
}

/**
 * Zerodha access tokens have no refresh flow -- once one is rejected, the
 * only recovery is a fresh OAuth login. Flag it invalid so callers (e.g.
 * /auth/status) can prompt the reconnect flow instead of erroring blindly.
 */
function isAuthError(err) {
    return err?.error_type === "TokenException" || err?.status_code === 403;
}

async function getProfile() {
    const accessToken = await loadAccessToken();

    if (!accessToken) {
        return null;
    }

    kite.setAccessToken(accessToken);

    try {
        return await kite.getProfile();
    } catch (err) {
        if (isAuthError(err)) {
            await tokenService.invalidateActiveToken();
        }
        throw err;
    }
}

/**
 * Remove stored token
 */
async function clearAccessToken() {
    await tokenService.invalidateActiveToken();
}

module.exports = {
    getLoginURL,
    generateSession,
    exchangeRequestToken,
    loadAccessToken,
    getProfile,
    clearAccessToken
};
