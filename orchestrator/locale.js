const configLanguage = require("./config").language;
const parser = require('./accept-language-parser');

class Locale {
    /**
     * Get the language based on request (accept-language) of client
     * Parse the accept-language, and based on priority of each language, choose a available language,.
     *
     * @param requestFromClient The request of the client
     * @returns {string}
     */
    static getSlugLanguage(requestFromClient) {
        const {supportedLanguages, mapSimilarLanguage} = configLanguage;
        const languagePick = parser.pick(supportedLanguages, requestFromClient.headers["accept-language"]);
        return supportedLanguages.includes(languagePick) ?
            languagePick : (
                mapSimilarLanguage[languagePick] ?
                    mapSimilarLanguage[languagePick] : mapSimilarLanguage.default);
    }

    /**
     * Get the default language from config
     * @returns {string}
     */
    static getSlugDefaultLanguage() {
        const {mapSimilarLanguage} = configLanguage;
        return mapSimilarLanguage.default;
    }
}

module.exports = Locale;

// template
// console.log('TESTE'+RED._("infotips:info.tip0"));
//
//
//
//
// const userLang = navigator.language || navigator.userLanguage;
// console.log('userLang', userLang);
// let dicLang = {
//     "pt-BR-----": "pt-BR-----",
//     "pt": "pt-BR-----",
//     "pt-pt": "pt-BR-----",
//     default: "en-US"
// };
// const finalLang = dicLang[userLang]? dicLang[userLang] : dicLang.default;
// console.log('finalLang', finalLang);
//
//
// console.log(RED._('dojot/template:template.label.property'));
// console.log(window);
// console.log(window.document);
//
// const localed = require("../locale");
//
// Labels
// There are four label properties of a node; label, paletteLabel, outputLabel and inputLabel.
//
//
// <span data-i18n="template.label.property">
