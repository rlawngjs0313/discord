const express = require('express');
const path = require('path');
const { oauthRouter, createHealthRouter } = require('./web.controller');

/**
 * Express 서버 초기화
 * @param {import('discord.js').Client} client 
 * @returns {import('express').Express}
 */
const createServer = (client) => {
    const app = express();
    
    // 뷰 엔진 설정 (Spring의 ViewResolver 역할)
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../../views'));

    app.use('/', oauthRouter);
    app.use('/', createHealthRouter(client));

    return app;
};

module.exports = { createServer };
