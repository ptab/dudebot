/*
TODO
- get src instead of display URL
- multiple tools
- multiple environments
- amsterdam vs frankfurt
- different replies instead of hardcoded one
- decent code
*/

const config = require('./config.json');
const https = require('https');
const tabletojson = require('tabletojson');

var controller = require('botkit').slackbot({ debug: false });
var slackbot = controller.spawn({ token: getToken('slack') }).startRTM((err, bot, payload) =>  {
    if (err) throw new Error('Error connecting to Slack: ', err)
});

var witbot = require('../witbot')(getToken('wit'))

var data = {};

controller.on(['direct_message', 'direct_mention', 'mention', 'ambient'], (bot, message) => {
    var confidenceToAsk = initialConfidence(message.event);
    var confidenceToReply = config.confidence.reply;

    var askForEnvironment = function(convo) {
        convo.ask(toUser(message, 'on which environment?'), (response, convo) => {
            witbot
            .process(response.text, { state: 'question_asked' })
            .hears('reply_with_environment', config.confidence.reply, (outcome) => {
                store(message, 'environment', outcome.entities.environment[0].value);
                convo.next();
            })
            .otherwise((outcome) => {
                log(outcome);
                invalidReply(convo, message, 'environment');
            });
        });
    };

    witbot
    .process(message.text)
    .hears('ask_with_both', confidenceToAsk, (outcome) => {
        store(message, 'tool', outcome.entities.tool[0].value);
        store(message, 'environment', outcome.entities.environment[0].value);
        reply(message);
    })
    .hears('ask_with_tool', confidenceToAsk, (outcome) => {
        store(message, 'tool', outcome.entities.tool[0].value);

        slackbot.startConversation(message, (_, convo) => {
            askForEnvironment(convo);
            convo.on('end', (convo) => {
                if (convo.status == 'completed') reply(message);
                clear(message);
            });
        });
    })
    .hears('ask_with_none', confidenceToAsk, (outcome) => {
        slackbot.startConversation(message, (_, convo) => {
            convo.ask(toUser(message, 'which tool?'), (response, convo) => {
                witbot
                .process(response.text, { state: 'question_asked' })
                .hears('reply_with_both', confidenceToReply, (outcome) => {
                    store(message, 'tool', outcome.entities.tool[0].value);
                    store(message, 'environment', outcome.entities.environment[0].value);
                    convo.next();
                })
                .hears('reply_with_tool', confidenceToReply, (outcome) => {
                    store(message, 'tool', outcome.entities.tool[0].value);
                    askForEnvironment(convo);
                    convo.next();
                })
                .otherwise((outcome) => {
                    log(outcome);
                    invalidReply(convo, message, 'tool');
                });
            });

            convo.on('end', (convo) => {
                if (convo.status == 'completed') reply(message);
                clear(message);
            });
        });
    });
});


function reply(message) {
    var tool = get(message, 'tool');
    var environment = get(message, 'environment');

    var options = {
        method: 'GET',
        host: config.confluence.api.host,
        port: config.confluence.api.port,
        path: '/wiki/rest/api/content/' + config.confluence.content_id + '?expand=body.view',
        auth: config.confluence.api.username + ':' + config.confluence.api.password
    };

    https.get(options, (res) => {
        res.setEncoding('utf8');
        res.on('data', (d) => {
            var table = tabletojson.convert(JSON.parse(d).body.view.value)[0];

            var url;
            for (var i in table) {
                var entry = table[i];
                if (entry.Tool.toUpperCase() === tool.toUpperCase()) {
                    url = entry[config.headers[environment]];
                    break;
                }
            }

            if (url) {
                slackbot.reply(message, toUser(message, 'there you go: ' + url));
            } else {
                slackbot.reply(message, toUser(message, '¯\\_(ツ)_/¯'));
                slackbot.reply(message, 'Try to find it here: ' + config.confluence.url);
            }
        });
    })
    .on('error', (e) => {
        bot.reply(message, toUser(message, 'Confluence is mad at me :('));
        bot.reply(message, 'See if it talks to you: ' + config.confluence.url);
    });
}

function invalidReply(convo, message, question) {
    if (inc(message, 'wrong_' + question) >= config.wrong_replies[question]) {
        slackbot.reply(message, toUser(message, '¯\\_(ツ)_/¯'));
        slackbot.reply(message, 'Try to find it here: ' + config.confluence.url);
        convo.stop();
    } else {
        slackbot.reply(message, 'uh? I don\'t know that one');
        convo.repeat();
        convo.next();
    }
}


// helper functions

function toUser(message, text) {
    return '<@' + message.user + '>: ' + text;
}

function inc(message, key) {
    if (!data[message.user]) data[message.user] = {};
    var c = get(message, key);
    if (!c) c = 0 ;
    store(message, key, ++c);
    return c;
}

function store(message, key, value) {
    if (!data[message.user]) data[message.user] = {};
    data[message.user][key] = value;
}

function get(message, key) {
    if (data[message.user]) return data[message.user][key];
    else return undefined;
}

function clear(message) {
    if (data[message.user]) delete data[message.user];
}

function initialConfidence(event) {
    if (event === 'ambient') return config.confidence.start;
    else return config.confidence.reply;
}

function getToken(name) {
    var token = config.tokens[name];
    if (token) return token;
    else throw new Error('Token for ' +  name + ' is not defined');
}

function log(outcome) {
    console.log('Heard', outcome.intent, 'with', outcome.confidence, 'confidence for:', outcome._text);
}
