const express = require('express');
const { escapeHtml } = require('../../utils/html-utils');
const config = require('../../config');

const router = express.Router();

/**
 * OAuth2 콜백 핸들러
 */
router.get('/oauth/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('잘못된 접근입니다: code가 누락되었습니다.');
    }

    try {
        // 1. 토큰 교환
        const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
                client_id: config.discord.clientId,
                client_secret: config.discord.clientSecret,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: config.discord.redirectUri,
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const tokens = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error('토큰 교환 실패:', tokens);
            return res.status(500).send('인증 토큰을 가져오는 데 실패했습니다.');
        }

        // 2. 사용자 정보 조회
        const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
        });

        const userData = await userResponse.json();

        if (!userResponse.ok) {
            console.error('사용자 정보 조회 실패:', userData);
            return res.status(500).send('사용자 정보를 조회하는 데 실패했습니다.');
        }

        // 3. 성공 응답
        const safeUsername = escapeHtml(userData.username);
        const discriminator = userData.discriminator === '0' ? '' : '#' + userData.discriminator;

        res.send(`
            <h1>봇 초대가 성공적으로 완료되었습니다!</h1>
            <p>환영합니다, <strong>${safeUsername}${discriminator}</strong>님!</p>
            <p>이제 디스코드 서버에서 봇을 사용할 수 있습니다. 이 창을 닫으셔도 좋습니다.</p>
        `);
    } catch (error) {
        console.error('OAuth2 처리 중 시스템 오류 발생:', error);
        res.status(500).send('서버 내부 오류가 발생했습니다.');
    }
});

/**
 * 헬스체크 (봇 상태 포함)
 */
const createHealthRouter = (client) => {
    const healthRouter = express.Router();
    healthRouter.get('/', (req, res) => {
        const status = client.isReady() ? 'Online' : 'Starting';
        res.send('Discord Bot Server is ' + status + '.');
    });
    return healthRouter;
};

module.exports = { oauthRouter: router, createHealthRouter };
