const crypto = require("crypto");
const session = require("express-session");
const RedisStore = require("connect-redis")(session);
const redis = require("../config/redis");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function getSecret() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    console.warn("SESSION_SECRET is not set: using a temporary one, so logins reset on every restart.");
    return crypto.randomBytes(32).toString("hex");
}

// The stored Zerodha token belongs to the server, so having one says nothing
// about who sent a request. This cookie is what identifies the owner's
// browser; it is only ever issued after a completed Zerodha login.
const sessionMiddleware = session({
    store: new RedisStore({ client: redis, prefix: "session:" }),
    name: "tradex.sid",
    secret: getSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: "auto", maxAge: ONE_DAY_MS },
});

function isOwner(req) {
    return req.session?.authenticated === true;
}

function requireOwner(req, res, next) {
    if (isOwner(req)) return next();
    return res.status(401).json({ success: false, message: "Please log in" });
}

// A new id on login, so a session id planted before login is worthless after it.
function startOwnerSession(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((regenerateErr) => {
            if (regenerateErr) return reject(regenerateErr);
            req.session.authenticated = true;
            req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
        });
    });
}

function endOwnerSession(req) {
    return new Promise((resolve, reject) => {
        req.session.destroy((err) => (err ? reject(err) : resolve()));
    });
}

module.exports = { sessionMiddleware, isOwner, requireOwner, startOwnerSession, endOwnerSession };
