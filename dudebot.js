/*
 TODO
  - parse the wiki page
  - decent code
  - multiple tools
  - multiple environments
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

var confidence = 0.6;

controller.on(['direct_message', 'direct_mention', 'mention', 'ambient'], function(bot, message) {
    //bot.reply(message, 'It looks like you\'re trying to find a tool. :)'); // TODO add clippy emoji

    var user = message.user

    witbot
    .process(message.text)
    .hears('ask_for_tool', confidence, function (outcome) {
        console.log(outcome);
        var tools = outcome.entities.tool;
        var environments = outcome.entities.environment;

        var tool;
        var environment;

        var askForTool = function(convo, ask_for_environment) {
            console.log('Asking for tool');
            convo.ask(msg(user, 'which tool?'), function(response, convo) {
                witbot
                .process(response.text)
                .hears('reply', confidence, function(outcome) {
                    tool = outcome.entities.tool[0].value ;
                    if (ask_for_environment) {
                        askForEnvironment(convo);
                    }
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
                .hears('reply', confidence, function(outcome) {
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

        endConversation = function(convo) {
            if (convo.status == 'completed') {
                console.log('tool: ' + tool);
                console.log('environment: ' + environment);

                var url = 'http://www.google.com';
                bot.reply(message, msg(user, tool + ' on ' + environment + ': ' + url));
            } else {
                // this happens if the conversation ended prematurely for some reason
                bot.reply(message, msg(user, '¯\\_(ツ)_/¯'));
            }
        };


        if (empty(tools) || empty(environments)) {
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
    });
});

function msg(user, text) {
    return '<@' + user + '>: ' + text ;
}

function empty(obj) {
    return !obj || obj.length === 0;
}
