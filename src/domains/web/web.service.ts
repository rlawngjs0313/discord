import crypto from 'crypto';
import config from '../../config';

export interface DiscordUser {
    id: string;
    username: string;
    discriminator: string;
    avatar: string | null;
    [key: string]: any;
}

/**
 * OAuth2 관련 비즈니스 로직
 */
export const oauthService = {
    /**
     * 보안 state 생성 및 인증 URL 반환
     */
    generateInviteContext: (): { state: string; url: string } => {
        const state = crypto.randomBytes(16).toString('hex');
        const url = new URL(config.discord.endpoints.authorize);
        url.searchParams.set('client_id', config.discord.clientId as string);
        url.searchParams.set('redirect_uri', config.discord.redirectUri as string);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', 'identify bot applications.commands');
        url.searchParams.set('state', state);

        return { state, url: url.toString() };
    },

    /**
     * Discord OAuth2 토큰 교환 및 사용자 정보 조회
     */
    handleCallback: async (code: string): Promise<DiscordUser> => {
        // 1. 토큰 교환
        const tokenResponse = await fetch(config.discord.endpoints.token, {
            method: 'POST',
            body: new URLSearchParams({
                client_id: config.discord.clientId as string,
                client_secret: config.discord.clientSecret as string,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: config.discord.redirectUri as string,
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            signal: AbortSignal.timeout(config.api.timeout)
        });

        const tokens = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok) {
            console.error('Token exchange failed:', tokens);
            const errorMsg = tokens.error_description || tokens.error || 'Unknown error during token exchange';
            throw new Error(`Token exchange failed: ${errorMsg}`);
        }

        // 2. 사용자 정보 조회
        const userResponse = await fetch(config.discord.endpoints.userMe, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
            signal: AbortSignal.timeout(config.api.timeout)
        });

        const userData = await userResponse.json().catch(() => ({}));
        if (!userResponse.ok) {
            console.error('User info fetch failed:', userData);
            const errorMsg = userData.message || 'Unknown error during user info fetch';
            throw new Error(`User info fetch failed: ${errorMsg}`);
        }

        return userData as DiscordUser;
    }
};
