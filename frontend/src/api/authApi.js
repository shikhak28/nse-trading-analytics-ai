const BASE_URL = "http://localhost:5000";

export const authApi = {

    async checkStatus() {

        const res = await fetch(
            `${BASE_URL}/auth/status`
        );

        return res.json();

    },

    connect() {

        window.location.href =
            `${BASE_URL}/auth/login`;

    },

    async logout() {

        const res = await fetch(
            `${BASE_URL}/auth/logout`
        );

        return res.json();

    }

};