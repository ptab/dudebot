/*
TODO
- get src instead of display URL
- divide again into ask for_both and ask_for_tool to avoid stupid enpty checks
- multiple tools
- multiple environments
- stop loops after x wwrong messages, point to wiki
- many possible replies instead of one
- decent code
*/

var config = require('./config.json');

var https = require('https');
var tabletojson = require('tabletojson');

var controller = require('botkit').slackbot({ debug: false });
var slackbot = controller.spawn({ token: getToken('slack') }).startRTM();
var witbot = require('witbot')(getToken('wit'));

controller.on(['direct_message', 'direct_mention', 'mention', 'ambient'], (bot, message) => {
    witbot
    .process(message.text)
    .hears('ask_for_tool', initialConfidence(message.event), (outcome) => {
        log(outcome);
        var tools = outcome.entities.tool;
        var environments = outcome.entities.environment;

        var tool;
        var environment;

        var askForTool = function(convo, ask_for_environment) {
            convo.ask(msg(message.user, 'which tool?'), (response, convo) => {
                witbot
                .process(response.text)
                .hears('reply_tool', config.confidence.reply, (outcome) => {
                    log(outcome);
                    tool = outcome.entities.tool[0].value ;
                    if (empty(environments)) askForEnvironment(convo);
                    convo.next();
                })
                .hears('reply_both', config.confidence.reply, (outcome) => {
                    log(outcome);
                    tool = outcome.entities.tool[0].value ;
                    environment = outcome.entities.environment[0].value;
                    convo.next();
                })
                .otherwise((outcome) => {
                    logTooLow(outcome);
                    bot.reply(message, 'uh? I don\'t know that one');
                    convo.repeat();
                    convo.next();
                });
            });
        } ;

        var askForEnvironment = function(convo) {
            convo.ask(msg(message.user, 'on which environment?'), (response, convo) => {
                witbot
                .process(response.text)
                .hears('reply_environment', config.confidence.reply, (outcome) => {
                    environment = outcome.entities.environment[0].value;
                    convo.next();
                })
                .otherwise((outcome) => {
                    logTooLow(outcome);
                    bot.reply(message, 'uh? I don\'t know that one');
                    convo.repeat();
                    convo.next();
                });
            });
        } ;

        var endConversation = function(convo) {
            if (convo.status == 'completed') {
                if (empty(tool)) tool = tools[0].value;
                if (empty(environment)) environment = environments[0].value;
                reply(message, tool, environment);
            }
        };

        if (empty(tools)) {
            slackbot.startConversation(message, (_, convo) => {
                askForTool(convo, empty(environments));
                convo.on('end', endConversation);
            });
        } else if (empty(environments)) {
            slackbot.startConversation(message, (_, convo) => {
                askForEnvironment(convo);
                convo.on('end', endConversation);
            });
        } else {
            var tool = tools[0].value;
            var environment = environments[0].value;
            reply(message, tool, environment) ;
        }
    });
});


function reply(message, tool, environment) {
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
            for (var i in table) {
                var entry = table[i];
                if (entry.Tool.toUpperCase() === tool.toUpperCase()) {
                    var url = entry[config.headers[environment]];
                    slackbot.reply(message, msg(message.user, 'there you go: ' + url));
                    return ;
                }
            }

            slackbot.reply(message, msg(message.user, '¯\\_(ツ)_/¯'));
            slackbot.reply(message, 'Try to find it here: ' + config.confluence.url);
        });
    })
    .on('error', (e) => {
        console.error(e);
    });
}


// helper functions

function msg(user, text) {
    return '<@' + user + '>: ' + text ;
}

function initialConfidence(event) {
    if (event === 'ambient') return config.confidence.start;
    else return config.confidence.reply;
}

function empty(obj) {
    return !obj || obj.length === 0;
}

function getToken(name) {
    var token = config.tokens[name] ;
    if (token) {
        return token;
    } else {
        console.error('Error: token for', name, 'is not defined');
        process.exit(1);
    }
}

function log(outcome) {
    console.log('Heard', outcome.intent, 'with', outcome.confidence, 'confidence for:', outcome._text);
}

function logTooLow(outcome) {
    console.log('Confidence', outcome.confidence, 'too low for:', outcome._text);
}
