/**
 * HTML 이스케이프 유틸리티 (XSS 방지)
 * @param {string} text 
 * @returns {string}
 */
const escapeHtml = (text) => {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

module.exports = { escapeHtml };
