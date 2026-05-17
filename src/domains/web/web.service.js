const express = require('express');
const { oauthRouter, createHealthRouter } = require('./web.controller');

/**
 * Express 서버 초기화
 * @param {import('discord.js').Client} client 
 * @returns {import('express').Express}
 */
const createServer = (client) => {
    const app = express();
    
    app.use('/', oauthRouter);
    app.use('/', createHealthRouter(client));

    return app;
};

module.exports = { createServer };
