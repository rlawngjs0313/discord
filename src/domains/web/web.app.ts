import express, { Express } from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import { Client } from 'discord.js';
import { oauthRouter, createHealthRouter } from './web.controller';
import config from '../../config';

/**
 * Express 서버 초기화
 * @param {Client} client 
 * @returns {Express}
 */
export const createServer = (client: Client): Express => {
    const app = express();
    
    app.use(cookieParser(config.web.cookieSecret));
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../../views'));

    app.use('/', oauthRouter);
    app.use('/', createHealthRouter(client));

    return app;
};
