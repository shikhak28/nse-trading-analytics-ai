// Relative -- rides the Vite dev proxy (see vite.config.js) so the browser
// sees these calls as same-origin, letting the session cookie flow without
// needing cross-site cookie settings.
const BASE_URL = "";

export const authApi = {

    async checkStatus() {

        const res = await fetch(
            `${BASE_URL}/auth/status`,
            { credentials: "include" }
        );

        return res.json();

    },

    connect() {

        window.location.href =
            `${BASE_URL}/auth/login`;

    },

    async logout() {

        const res = await fetch(
            `${BASE_URL}/auth/logout`,
            { credentials: "include" }
        );

        return res.json();

    }

};
