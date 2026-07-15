const express = require("express");

const router = express.Router();

const authService = require("../services/auth.service");
const tokenService = require("../services/token.service");
const userService = require("../services/user.service");

/**
 * Redirect user to Zerodha Login
 */
router.get("/login", (req, res) => {

    const loginUrl = authService.getLoginURL();

    return res.redirect(loginUrl);

});

/**
 * Zerodha Callback
 */
router.get("/callback", async (req, res) => {

    try {

        const requestToken = req.query.request_token;

        if (!requestToken) {

            return res.status(400).json({
                success: false,
                message: "Request Token Missing"
            });

        }

        await authService.exchangeRequestToken(requestToken);

        console.log("Zerodha login successful");

        return res.redirect(process.env.FRONTEND_URL || "http://localhost:5173");


    } catch (err) {

        console.error(err);

        return res.status(500).json({

            success: false,

            message: err.message

        });

    }

});

/**
 * Check Login Status
 */
router.get("/status", async (req, res) => {

    const token = await authService.loadAccessToken();
    const tokenMeta = await tokenService.getLatestTokenMeta();

    if (!token) {
        return res.json({ connected: false, authenticated: false, tokenStatus: tokenMeta });
    }

    const profile = await authService.getProfile().catch(() => null);
    const connected = Boolean(profile);
    const user = await userService.getUser();

    res.json({

        connected,
        authenticated: connected,
        profile,
        user,
        tokenStatus: tokenMeta

    });

});



/**
 * Logout
 */
router.get("/logout", async (req, res) => {

    await authService.clearAccessToken();

    res.json({

        success: true

    });

});


module.exports = router;