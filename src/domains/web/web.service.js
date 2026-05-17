const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const config = require('../../config');

/**
 * OAuth2 관련 비즈니스 로직
 */
const oauthService = {
    /**
     * 보안 state 생성 및 인증 URL 반환
     */
    generateInviteContext: () => {
        const state = crypto.randomBytes(16).toString('hex');
        const url = new URL(config.discord.endpoints.authorize);
        url.searchParams.set('client_id', config.discord.clientId);
        url.searchParams.set('redirect_uri', config.discord.redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', 'identify bot applications.commands');
        url.searchParams.set('state', state);

        return { state, url: url.toString() };
    },

    /**
     * Discord OAuth2 토큰 교환 및 사용자 정보 조회
     */
    handleCallback: async (code) => {
        // 1. 토큰 교환
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
            console.error('Token exchange failed:', tokens);
            throw new Error('Token exchange failed');
        }

        // 2. 사용자 정보 조회
        const userResponse = await fetch(config.discord.endpoints.userMe, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
            signal: AbortSignal.timeout(config.api.timeout)
        });

        const userData = await userResponse.json();
        if (!userResponse.ok) {
            console.error('User info fetch failed:', userData);
            throw new Error('User info fetch failed');
        }

        return userData;
    }
};

/**
 * Express 서버 초기화 (Main Entry Point 역할 유지)
 */
const createServer = (client) => {
    // 순환 참조 방지를 위해 지연 로딩
    const { oauthRouter, createHealthRouter } = require('./web.controller');
    
    const app = express();
    
    app.use(cookieParser(config.web.cookieSecret));
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../../views'));

    app.use('/', oauthRouter);
    app.use('/', createHealthRouter(client));

    return app;
};

module.exports = { createServer, oauthService };
