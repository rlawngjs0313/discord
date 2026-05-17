const express = require('express');
const crypto = require('crypto');
const config = require('../../config');

const router = express.Router();

/**
 * 봇 초대 링크 생성 (state 포함)
 */
router.get('/invite', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    
    // CSRF 방지를 위해 state를 보안 쿠키에 저장 (15분 만료)
    res.cookie('oauth_state', state, { 
        maxAge: 15 * 60 * 1000, 
        httpOnly: true, 
        secure: process.env.NODE_ENV === 'production' 
    });

    const url = new URL(config.discord.endpoints.authorize);
    url.searchParams.set('client_id', config.discord.clientId);
    url.searchParams.set('redirect_uri', config.discord.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify bot applications.commands');
    url.searchParams.set('state', state);

    res.redirect(url.toString());
});

/**
 * OAuth2 콜백 핸들러 (state 검증 포함)
 */
router.get('/oauth/callback', async (req, res) => {
    const { code, state } = req.query;
    const savedState = req.cookies.oauth_state;

    // 1. State 검증 (CSRF 방어)
    if (!state || state !== savedState) {
        return res.status(403).send('잘못된 접근입니다: 보안 토큰(state)이 일치하지 않습니다.');
    }

    if (!code) {
        return res.status(400).send('잘못된 접근입니다: code가 누락되었습니다.');
    }

    // 검증 후 쿠키 삭제
    res.clearCookie('oauth_state');

    try {
        // 2. 토큰 교환 (타임아웃 적용)
        const tokenResponse = await fetch(config.discord.endpoints.token, {
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
            signal: AbortSignal.timeout(config.api.timeout)
        });

        const tokens = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error('토큰 교환 실패:', tokens);
            return res.status(500).send('인증 토큰을 가져오는 데 실패했습니다.');
        }

        // 3. 사용자 정보 조회 (타임아웃 적용)
        const userResponse = await fetch(config.discord.endpoints.userMe, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
            signal: AbortSignal.timeout(config.api.timeout)
        });

        const userData = await userResponse.json();

        if (!userResponse.ok) {
            console.error('사용자 정보 조회 실패:', userData);
            return res.status(500).send('사용자 정보를 조회하는 데 실패했습니다.');
        }

        // 4. 성공 응답 (ModelAndView 스타일)
        res.render('callback', {
            username: userData.username,
            discriminator: userData.discriminator
        });
    } catch (error) {
        if (error.name === 'TimeoutError') {
            console.error('디스코드 API 호출 타임아웃 발생');
            return res.status(504).send('인증 서비스 응답 시간이 초과되었습니다.');
        }
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
        res.render('index', { status });
    });
    return healthRouter;
};

module.exports = { oauthRouter: router, createHealthRouter };
