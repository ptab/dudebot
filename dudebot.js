/*
TODO
- parse the wiki page
- separate intents into ask_for_tool and ask_for_both (to prevent stupid empty checks)
- multiple tools
- multiple environments
- stop loops after x wwrong messages, point to wiki
- many possible replies instead of one
- decent code
*/


if (!process.env.slackToken) {
    console.log('Error: Specify slack-token in environment');
    process.exit(1);
}

if (!process.env.witToken) {
    console.log('Error: Specify wit-token in environment');
    process.exit(1);
}

var slackToken = process.env.slackToken;
var witToken = process.env.witToken;

var Botkit = require('botkit');
var Witbot = require('witbot');

var controller = Botkit.slackbot({ debug: false });
var slackbot = controller.spawn({ token: slackToken }).startRTM();
var witbot = Witbot(witToken);

controller.on(['direct_message', 'direct_mention', 'mention', 'ambient'], function(bot, message) {
    var user = message.user
    var confidence = calc_confidence(message.event) ;

    witbot
    .process(message.text)
    .hears('ask_for_tool', confidence, function (outcome) {
        console.log(outcome);
        var tools = outcome.entities.tool;
        var environments = outcome.entities.environment;

        var tool;
        var environment;

        var askForTool = function(convo, ask_for_environment) {
            convo.ask(msg(user, 'which tool?'), function(response, convo) {
                witbot
                .process(response.text)
                .hears('reply_tool', confidence, function(outcome) {
                    tool = outcome.entities.tool[0].value ;

                    if (empty(environments)) {
                        askForEnvironment(convo);
                    }

                    convo.next();
                })
                .hears('reply_both', confidence, function(outcome) {
                    tool = outcome.entities.tool[0].value ;
                    environment = outcome.entities.environment[0].value;
                    convo.next();
                })
                .otherwise(function(outcome) {
                    bot.reply(message, msg(user, 'uh? I don\'t know that one'));
                    convo.repeat();
                    convo.next();
                });
            });
        } ;

        var askForEnvironment = function(convo) {
            console.log('Asking for environment');
            convo.ask(msg(user, 'on which environment?'), function (response, convo) {
                witbot
                .process(response.text)
                .hears('reply_environment', confidence, function(outcome) {
                    environment = outcome.entities.environment[0].value;
                    convo.next();
                })
                .otherwise(function(outcome) {
                    console.log('Confidence too low (' + outcome.confidence + ') for: ' + outcome._text);
                    bot.reply(message, msg(user, 'uh? I don\'t know that one'));
                    convo.repeat();
                    convo.next();
                });
            });
        } ;

        endConversation = function(convo) {
            if (convo.status == 'completed') {
                if (empty(tool)) {
                    tool = tools[0].value;
                }
                if (empty(environment)) {
                    environment = environments[0].value;
                }

                var url = 'http://www.google.com';
                bot.reply(message, msg(user, tool + ' on ' + environment + ': ' + url));
            } else {
                // this happens if the conversation ended prematurely for some reason
                bot.reply(message, msg(user, '¯\\_(ツ)_/¯'));
            }
        };


        if (empty(tools)) {
            slackbot.startConversation(message, function(err, convo) {
                askForTool(convo, empty(environments));
                convo.on('end', endConversation);
            });
        } else if (empty(environments)) {
            slackbot.startConversation(message, function(err, convo) {
                askForEnvironment(convo);
                convo.on('end', endConversation);
            });
        } else {
            var tool = tools[0].value;
            var environment = environments[0].value;

            var url = 'http://www.google.com';
            bot.reply(message, tool + ' on ' + environment + ': ' + url);
        }
    })
    .otherwise(function(outcome) {
        console.log('Confidence too low (' + outcome.confidence + ') for: ' + outcome._text);
    });
});

function msg(user, text) {
    return '<@' + user + '>: ' + text ;
}

function calc_confidence(event) {
    if (event === 'ambient') return 0.8;
    else return 0.6;
}

function empty(obj) {
    return !obj || obj.length === 0;
}
