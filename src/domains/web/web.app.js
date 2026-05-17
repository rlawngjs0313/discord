const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { oauthRouter, createHealthRouter } = require('./web.controller');
const config = require('../../config');

/**
 * Express 서버 초기화
 * @param {import('discord.js').Client} client 
 * @returns {import('express').Express}
 */
const createServer = (client) => {
    const app = express();
    
    app.use(cookieParser(config.web.cookieSecret));
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../../views'));

    app.use('/', oauthRouter);
    app.use('/', createHealthRouter(client));

    return app;
};

module.exports = { createServer };
