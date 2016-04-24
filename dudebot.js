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
var slackbot = controller.spawn({ token: getToken('slack') }).startRTM((err, bot, payload) =>  {
    if (err) throw new Error('Error connecting to Slack: ', err)
});
var witbot = require('witbot')(getToken('wit'));

controller.on(['direct_message', 'direct_mention', 'mention', 'ambient'], (bot, message) => {
    var confidenceToAsk = initialConfidence(message.event) ;
    var confidenceToReply = config.confidence.reply ;

    var tool;
    var environment;

    var askForEnvironment = function(convo) {
        convo.ask(msg(message.user, 'on which environment?'), (response, convo) => {
            witbot
            .process(response.text)
            .hears('reply_with_environment', config.confidence.reply, (outcome) => {
                environment = outcome.entities.environment[0].value;
                convo.next();
            })
            .otherwise((outcome) => {
                log(outcome);
                bot.reply(message, 'uh? I don\'t know that one');
                convo.repeat();
                convo.next();
            });
        });
    };


    witbot
    .process(message.text)
    .hears('ask_with_both', confidenceToAsk, (outcome) => {
        tool = outcome.entities.tool[0].value;
        environment = outcome.entities.environment[0].value;
        reply(message, tool, environment);
    })
    .hears('ask_with_tool', confidenceToAsk, (outcome) => {
        tool = outcome.entities.tool[0].value;

        slackbot.startConversation(message, (_, convo) => {
            askForEnvironment(convo);
            convo.on('end', (convo) => {
                if (convo.status == 'completed') {
                    reply(message, tool, environment);
                }
            });
        });
    })
    .hears('ask_with_none', confidenceToAsk, (outcome) => {
        slackbot.startConversation(message, (_, convo) => {
            convo.ask(msg(message.user, 'which tool?'), (response, convo) => {
                witbot
                .process(response.text)
                .hears('reply_with_both', confidenceToReply, (outcome) => {
                    log(outcome);
                    tool = outcome.entities.tool[0].value ;
                    environment = outcome.entities.environment[0].value;
                    convo.next();
                })
                .hears('reply_with_tool', confidenceToReply, (outcome) => {
                    log(outcome);
                    tool = outcome.entities.tool[0].value ;
                    askForEnvironment(convo);
                    convo.next();
                })
                .otherwise((outcome) => {
                    log(outcome);
                    bot.reply(message, 'uh? I don\'t know that one');
                    convo.repeat();
                    convo.next();
                });
            });

            convo.on('end', (convo) => {
                if (convo.status == 'completed') {
                    reply(message, tool, environment);
                }
            });
        });
    })
    .otherwise((outcome) => {
        logTooLow(outcome);
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

function getToken(name) {
    var token = config.tokens[name] ;
    if (token) return token;
    else throw new Error('Token for ' +  name + ' is not defined');
}

function log(outcome) {
    console.log('Heard', outcome.intent, 'with', outcome.confidence, 'confidence for:', outcome._text);
}
