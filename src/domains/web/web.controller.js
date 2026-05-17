const express = require('express');
const { oauthService } = require('./web.service');

const router = express.Router();

/**
 * 봇 초대 링크 생성 (state 포함)
 */
router.get('/invite', (req, res) => {
    const { state, url } = oauthService.generateInviteContext();
    
    // CSRF 방지를 위해 state를 보안 쿠키에 저장 (15분 만료, 서명 활성화)
    res.cookie('oauth_state', state, { 
        maxAge: 15 * 60 * 1000, 
        httpOnly: true, 
        secure: process.env.NODE_ENV === 'production',
        signed: true
    });

    res.redirect(url);
});

/**
 * OAuth2 콜백 핸들러 (state 검증 포함)
 */
router.get('/oauth/callback', async (req, res) => {
    const { code, state } = req.query;
    const savedState = req.signedCookies.oauth_state;

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
        // 2. 서비스 레이어 위임 (비즈니스 로직 수행)
        const userData = await oauthService.handleCallback(code);

        // 3. 성공 응답 (ModelAndView 스타일)
        res.render('callback', {
            username: userData.username,
            discriminator: userData.discriminator
        });
    } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
            console.error('디스코드 API 호출 타임아웃 또는 중단 발생');
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
