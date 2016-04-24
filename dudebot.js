/*
TODO
- export properties to other file
- get src instead of display
- divide again into ask for_both and ask_for_tool to avoid stupid enpty checks
- multiple tools
- multiple environments
- stop loops after x wwrong messages, point to wiki
- many possible replies instead of one
- decent code
*/

var slackToken = assertTokenSet('slackToken');
var witToken = assertTokenSet('witToken');

var confidenceToStart = 0.8 ;
var confidenceToReply = 0.6;

var headers = {
    int: 'Integration',
    integration: 'Integration',
    demo: 'Demo',
    lp: 'L&P',
    'l&p': 'L&P',
    prod: 'Production (Amsterdam)',
    production: 'Production (Amsterdam)'
};

var dudePage = 'https://taborda.atlassian.net/wiki/pages/viewpage.action?pageId=1212423';


var controller = require('botkit').slackbot({ debug: false });
var slackbot = controller.spawn({ token: slackToken }).startRTM();
var witbot = require('witbot')(witToken);

var https = require('https');
var tabletojson = require('tabletojson');


controller.on(['direct_message', 'direct_mention', 'mention', 'ambient'], (bot, message) => {
    var user = message.user

    witbot
    .process(message.text)
    .hears('ask_for_tool', initialConfidence(message.event), (outcome) => {
        log(outcome);
        var tools = outcome.entities.tool;
        var environments = outcome.entities.environment;

        var tool;
        var environment;

        var askForTool = function(convo, ask_for_environment) {
            convo.ask(msg(user, 'which tool?'), (response, convo) => {
                witbot
                .process(response.text)
                .hears('reply_tool', confidenceToReply, (outcome) => {
                    log(outcome);
                    tool = outcome.entities.tool[0].value ;
                    if (empty(environments)) askForEnvironment(convo);
                    convo.next();
                })
                .hears('reply_both', confidenceToReply, (outcome) => {
                    log(outcome);
                    tool = outcome.entities.tool[0].value ;
                    environment = outcome.entities.environment[0].value;
                    convo.next();
                })
                .otherwise((outcome) => {
                    console.log('Confidence', outcome.confidence, 'too low for:', outcome._text);
                    bot.reply(message, 'uh? I don\'t know that one');
                    convo.repeat();
                    convo.next();
                });
            });
        } ;

        var askForEnvironment = function(convo) {
            convo.ask(msg(user, 'on which environment?'), (response, convo) => {
                witbot
                .process(response.text)
                .hears('reply_environment', confidenceToReply, (outcome) => {
                    environment = outcome.entities.environment[0].value;
                    convo.next();
                })
                .otherwise((outcome) => {
                    console.log('Confidence', outcome.confidence, 'too low for:', outcome._text);
                    bot.reply(message, 'uh? I don\'t know that one');
                    convo.repeat();
                    convo.next();
                });
            });
        } ;

        endConversation = function(convo) {
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
    })
    .otherwise((outcome) => {
        console.log('Confidence', outcome.confidence, 'too low for:', outcome._text);
    });
});

function msg(user, text) {
    return '<@' + user + '>: ' + text ;
}

function initialConfidence(event) {
    if (event === 'ambient') return confidenceToStart;
    else return confidenceToReply;
}

function empty(obj) {
    return !obj || obj.length === 0;
}

function assertTokenSet(token) {
    if (token) {
        return process.env[token];
    } else {
        console.error('Error: Specify', token, 'in environment');
        process.exit(1);
    }
}

function log(outcome) {
    console.log('Heard', outcome.intent, 'with', outcome.confidence, 'confidence for:', outcome._text);
}

function reply(message, tool, environment) {
    var options = {
        method: 'GET',
        host: 'taborda.atlassian.net',
        port: 443,
        path: '/wiki/rest/api/content/1212423?expand=body.view',
        auth: 'username:password'
    };

    https.get(options, (res) => {
        res.setEncoding('utf8');
        res.on('data', (d) => {
            var table = tabletojson.convert(JSON.parse(d).body.view.value)[0];
            console.log(table)

            var url ;
            for (var i in table) {
                var entry = table[i];
                if (entry.Tool.toUpperCase() === tool.toUpperCase()) {
                    url = entry[headers[environment]];
                    break;
                }
            }

            if (url) {
                slackbot.reply(message, msg(message.user, 'there you go: ' + url));
            } else {
                slackbot.reply(message, msg(message.user, '¯\\_(ツ)_/¯'));
                slackbot.reply(message, 'Try to find it here: ' + dudePage);
            }
        });
    })
    .on('error', (e) => {
        console.error(e);
    });
}
